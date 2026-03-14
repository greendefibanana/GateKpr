import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { join } from "node:path";

import {
  MAGIC_ROUTER_ENV,
  actionFromLabel,
  deriveApiKeyPda,
  deriveAuditCheckpointPda,
  deriveGatewayPda,
  deriveKeyId,
  deriveOrganizationPda,
  deriveQuotaPolicyPda,
  deriveQuotaRuntimePda,
  deriveRolePda,
  getProgram,
  maskFromPolicyInput,
  readWallet,
  reasonLabel,
  sendThroughMagicRouter,
  summarizeRuntimeHealth,
  toNumber,
} from "../client/gatekeeper";

type ParsedArgs = {
  command: string;
  flags: Record<string, string>;
};

type ClientContext = {
  wallet: anchor.Wallet;
  baseProvider: anchor.AnchorProvider;
  baseProgram: any;
  routerConnection: Connection | null;
  routerProvider: anchor.AnchorProvider | null;
  routerProgram: any | null;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const nextValue = rest[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      flags[key] = "true";
      continue;
    }

    flags[key] = nextValue;
    index += 1;
  }

  return { command, flags };
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

function createContext(flags: Record<string, string>): ClientContext {
  const baseEndpoint =
    flags.cluster ?? process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  const routerEndpoint = flags["magic-router"] ?? process.env[MAGIC_ROUTER_ENV] ?? null;
  const walletPath =
    flags.wallet ??
    process.env.ANCHOR_WALLET ??
    join(process.cwd(), "wallets", "localnet-authority.json");
  const wallet = readWallet(walletPath);

  const baseConnection = new Connection(baseEndpoint, "confirmed");
  const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, {
    commitment: "confirmed",
  });
  const baseProgram = getProgram(baseProvider);

  if (!routerEndpoint) {
    return {
      wallet,
      baseProvider,
      baseProgram,
      routerConnection: null,
      routerProvider: null,
      routerProgram: null,
    };
  }

  const routerConnection = new Connection(routerEndpoint, "confirmed");
  const routerProvider = new anchor.AnchorProvider(routerConnection, wallet, {
    commitment: "confirmed",
  });

  return {
    wallet,
    baseProvider,
    baseProgram,
    routerConnection,
    routerProvider,
    routerProgram: getProgram(routerProvider),
  };
}

async function sendMethod(
  methods: any,
  context: ClientContext,
  useMagicRouter: boolean,
): Promise<string> {
  if (!useMagicRouter) {
    return methods.rpc();
  }

  if (!context.routerConnection) {
    throw new Error(
      "Magic Router flow requested but no router endpoint is configured. Set --magic-router or MAGIC_ROUTER_URL.",
    );
  }

  const transaction = await methods.transaction();
  return sendThroughMagicRouter(context.routerConnection, transaction, context.wallet);
}

async function fetchRuntimeAccount(context: ClientContext, quotaRuntime: PublicKey): Promise<any> {
  if (context.routerProgram) {
    try {
      return await (context.routerProgram.account as any).quotaRuntime.fetch(quotaRuntime);
    } catch {
      // Fall through to the base provider when the router is not available locally.
    }
  }

  return (context.baseProgram.account as any).quotaRuntime.fetch(quotaRuntime);
}

async function initializeGateway(context: ClientContext) {
  const gateway = deriveGatewayPda();
  const signature = await context.baseProgram.methods
    .initializeGateway()
    .accounts({
      gateway,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`gateway: ${gateway.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function createOrg(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const name = requireFlag(flags, "name");
  const orgAuthority = flags["org-authority"]
    ? new PublicKey(flags["org-authority"])
    : context.wallet.publicKey;
  const organization = deriveOrganizationPda(gateway, name);

  const signature = await context.baseProgram.methods
    .createOrganization(name, orgAuthority)
    .accounts({
      gateway,
      organization,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`organization: ${organization.toBase58()}`);
  console.log(`authority: ${orgAuthority.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function createRole(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const roleName = requireFlag(flags, "role-name");
  const organization = deriveOrganizationPda(gateway, orgName);
  const role = deriveRolePda(organization, roleName);

  const signature = await context.baseProgram.methods
    .createRole(roleName)
    .accounts({
      organization,
      role,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`role: ${role.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function attachPolicy(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const roleName = requireFlag(flags, "role-name");
  const policy = requireFlag(flags, "policy");
  const organization = deriveOrganizationPda(gateway, orgName);
  const role = deriveRolePda(organization, roleName);
  const mask = maskFromPolicyInput(policy);

  const signature = await context.baseProgram.methods
    .attachPolicyToRole(new anchor.BN(mask))
    .accounts({
      organization,
      role,
      authority: context.wallet.publicKey,
    })
    .rpc();

  console.log(`policy_mask: ${mask}`);
  console.log(`signature: ${signature}`);
}

async function createKey(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const roleName = requireFlag(flags, "role-name");
  const label = requireFlag(flags, "label");
  const material = requireFlag(flags, "key-material");
  const organization = deriveOrganizationPda(gateway, orgName);
  const role = deriveRolePda(organization, roleName);
  const keyId = deriveKeyId(material);
  const apiKey = deriveApiKeyPda(organization, keyId);

  const signature = await context.baseProgram.methods
    .createApiKey(keyId, label)
    .accounts({
      organization,
      role,
      apiKey,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`key_id: ${keyId.toBase58()}`);
  console.log(`api_key: ${apiKey.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function createQuotaPolicy(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const maxRequests = Number(requireFlag(flags, "max-requests"));
  const windowSeconds = Number(requireFlag(flags, "window-seconds"));
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaPolicy = deriveQuotaPolicyPda(apiKey);

  const signature = await context.baseProgram.methods
    .createQuotaPolicy(new anchor.BN(maxRequests), new anchor.BN(windowSeconds))
    .accounts({
      organization,
      apiKey,
      quotaPolicy,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`quota_policy: ${quotaPolicy.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function initRuntime(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaPolicy = deriveQuotaPolicyPda(apiKey);
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);
  const auditCheckpoint = deriveAuditCheckpointPda(apiKey);

  const signature = await context.baseProgram.methods
    .initializeQuotaRuntime()
    .accounts({
      organization,
      apiKey,
      quotaPolicy,
      quotaRuntime,
      auditCheckpoint,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`quota_runtime: ${quotaRuntime.toBase58()}`);
  console.log(`audit_checkpoint: ${auditCheckpoint.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function delegateRuntime(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const commitFrequencyMs = Number(requireFlag(flags, "commit-frequency-ms"));
  const validator = flags.validator ? new PublicKey(flags.validator) : null;
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaPolicy = deriveQuotaPolicyPda(apiKey);
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);

  const signature = await context.baseProgram.methods
    .delegateQuotaRuntime(validator, commitFrequencyMs)
    .accounts({
      organization,
      apiKey,
      quotaPolicy,
      quotaRuntime,
      authority: context.wallet.publicKey,
      ownerProgram: context.baseProgram.programId,
    })
    .rpc();

  console.log(`quota_runtime: ${quotaRuntime.toBase58()}`);
  console.log(`commit_frequency_ms: ${commitFrequencyMs}`);
  console.log(`signature: ${signature}`);
}

async function commitRuntime(context: ClientContext, flags: Record<string, string>) {
  if (!context.routerProgram) {
    throw new Error("commit-runtime requires --magic-router or MAGIC_ROUTER_URL");
  }

  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);

  const methods = context.routerProgram.methods.commitQuotaRuntime().accounts({
    organization,
    apiKey,
    quotaRuntime,
    authority: context.wallet.publicKey,
  });
  const signature = await sendMethod(methods, context, true);

  console.log(`quota_runtime: ${quotaRuntime.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function undelegateRuntime(context: ClientContext, flags: Record<string, string>) {
  if (!context.routerProgram) {
    throw new Error("undelegate-runtime requires --magic-router or MAGIC_ROUTER_URL");
  }

  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);

  const methods = context.routerProgram.methods
    .commitAndUndelegateQuotaRuntime()
    .accounts({
      organization,
      apiKey,
      quotaRuntime,
      authority: context.wallet.publicKey,
    });
  const signature = await sendMethod(methods, context, true);

  console.log(`quota_runtime: ${quotaRuntime.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function settleCheckpoint(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);
  const auditCheckpoint = deriveAuditCheckpointPda(apiKey);

  const signature = await context.baseProgram.methods
    .settleRuntimeCheckpoint()
    .accounts({
      organization,
      apiKey,
      quotaRuntime,
      auditCheckpoint,
      authority: context.wallet.publicKey,
    })
    .rpc();

  console.log(`audit_checkpoint: ${auditCheckpoint.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function callEndpoint(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const action = actionFromLabel(requireFlag(flags, "action"));
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaPolicy = deriveQuotaPolicyPda(apiKey);
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);
  const apiKeyAccount = await (context.baseProgram.account as any).apiKey.fetch(apiKey);
  const runtimeAccount = await fetchRuntimeAccount(context, quotaRuntime);
  const role = apiKeyAccount.role as PublicKey;
  const useMagicRouter = Boolean(context.routerProgram && runtimeAccount.isDelegated);
  const program = useMagicRouter ? context.routerProgram : context.baseProgram;

  const methods = program.methods.consumeRequest(action).accounts({
    payer: context.wallet.publicKey,
    organization,
    role,
    apiKey,
    quotaPolicy,
    quotaRuntime,
  });
  const signature = await sendMethod(methods, context, useMagicRouter);
  const updatedRuntime = await fetchRuntimeAccount(context, quotaRuntime);
  const latestRecord = updatedRuntime.rollingAudit.at(-1);

  console.log(`transport: ${useMagicRouter ? "magic-router" : "base-rpc"}`);
  console.log(`allowed: ${latestRecord?.allowed ?? false}`);
  console.log(`reason: ${reasonLabel(latestRecord?.reason ?? -1)}`);
  console.log(
    `quota: ${toNumber(updatedRuntime.currentWindowUsed)}/${toNumber(
      (await (context.baseProgram.account as any).quotaPolicy.fetch(quotaPolicy)).maxRequests,
    )}`,
  );
  console.log(`rolling_sequence: ${toNumber(updatedRuntime.rollingSequence)}`);
  console.log(`signature: ${signature}`);

  if (latestRecord && !latestRecord.allowed) {
    process.exitCode = 1;
  }
}

async function revokeKey(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));

  const signature = await context.baseProgram.methods
    .revokeApiKey()
    .accounts({
      organization,
      apiKey,
      authority: context.wallet.publicKey,
    })
    .rpc();

  console.log(`api_key: ${apiKey.toBase58()}`);
  console.log(`signature: ${signature}`);
}

async function viewAudit(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);
  const auditCheckpoint = deriveAuditCheckpointPda(apiKey);
  const runtimeAccount = await fetchRuntimeAccount(context, quotaRuntime);
  const checkpointAccount = await (context.baseProgram.account as any).auditCheckpoint.fetch(
    auditCheckpoint,
  );

  console.log(`quota_runtime: ${quotaRuntime.toBase58()}`);
  console.log(
    `runtime total allowed/rejected: ${toNumber(runtimeAccount.totalAllowed)}/${toNumber(runtimeAccount.totalRejected)}`,
  );
  console.log(`runtime delegated: ${runtimeAccount.isDelegated}`);
  console.log("rolling audit:");
  for (const entry of runtimeAccount.rollingAudit) {
    console.log(
      `  seq=${toNumber(entry.sequence)} action=${entry.action} allowed=${entry.allowed} reason=${reasonLabel(entry.reason)} quota_used=${toNumber(entry.quotaUsedAfter)}`,
    );
  }

  console.log("checkpoint:");
  console.log(
    `  settled_sequence=${toNumber(checkpointAccount.settledSequence)} total_allowed=${toNumber(checkpointAccount.totalAllowed)} total_rejected=${toNumber(checkpointAccount.totalRejected)}`,
  );
}

async function runtimeStatus(context: ClientContext, flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);
  const auditCheckpoint = deriveAuditCheckpointPda(apiKey);
  const runtimeAccount = await fetchRuntimeAccount(context, quotaRuntime);
  const checkpointAccount = await (context.baseProgram.account as any).auditCheckpoint.fetch(
    auditCheckpoint,
  );
  const health = summarizeRuntimeHealth(runtimeAccount, checkpointAccount);

  console.log(`quota_runtime: ${quotaRuntime.toBase58()}`);
  console.log(`delegated: ${health.delegated}`);
  console.log(`rolling_sequence: ${health.rollingSequence}`);
  console.log(`settled_sequence: ${health.settledSequence}`);
  console.log(`drift: ${health.drift}`);
  console.log(`rolling_audit_entries: ${health.rollingAuditEntries}`);
  console.log(`current_window_used: ${health.currentWindowUsed}`);
  console.log(`totals: allowed=${health.totalAllowed} rejected=${health.totalRejected}`);
  console.log(`recommended_action: ${health.recommendedAction}`);
  for (const note of health.notes) {
    console.log(`note: ${note}`);
  }
}

function printHelp() {
  console.log("Gatekeeper CLI");
  console.log("Commands:");
  console.log("  init-gateway");
  console.log("  create-org --name <org> [--org-authority <pubkey>]");
  console.log("  create-role --org-name <org> --role-name <role>");
  console.log("  attach-policy --org-name <org> --role-name <role> --policy <csv|mask>");
  console.log("  set-policy --org-name <org> --role-name <role> --policy <csv|mask>");
  console.log("  create-key --org-name <org> --role-name <role> --label <label> --key-material <secret>");
  console.log("  create-quota-policy --org-name <org> --key-material <secret> --max-requests <n> --window-seconds <n>");
  console.log("  create-quota --org-name <org> --key-material <secret> --max-requests <n> --window-seconds <n>");
  console.log("  init-runtime --org-name <org> --key-material <secret>");
  console.log("  delegate-runtime --org-name <org> --key-material <secret> --commit-frequency-ms <n> [--validator <pubkey>]");
  console.log("  commit-runtime --org-name <org> --key-material <secret>");
  console.log("  undelegate-runtime --org-name <org> --key-material <secret>");
  console.log("  settle-checkpoint --org-name <org> --key-material <secret>");
  console.log("  call-endpoint --org-name <org> --key-material <secret> --action <metrics:read|metrics:write|users:read|users:write|admin>");
  console.log("  revoke-key --org-name <org> --key-material <secret>");
  console.log("  view-audit --org-name <org> --key-material <secret>");
  console.log("  runtime-status --org-name <org> --key-material <secret>");
  console.log("Global flags:");
  console.log("  --cluster <rpc-url>");
  console.log("  --wallet <path>");
  console.log(`  --magic-router <router-url> or ${MAGIC_ROUTER_ENV}`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === "help" || command === "--help") {
    printHelp();
    return;
  }

  const context = createContext(flags);

  switch (command) {
    case "init-gateway":
      await initializeGateway(context);
      return;
    case "create-org":
      await createOrg(context, flags);
      return;
    case "create-role":
      await createRole(context, flags);
      return;
    case "attach-policy":
    case "set-policy":
      await attachPolicy(context, flags);
      return;
    case "create-key":
      await createKey(context, flags);
      return;
    case "create-quota-policy":
    case "create-quota":
      await createQuotaPolicy(context, flags);
      return;
    case "init-runtime":
      await initRuntime(context, flags);
      return;
    case "delegate-runtime":
      await delegateRuntime(context, flags);
      return;
    case "commit-runtime":
      await commitRuntime(context, flags);
      return;
    case "undelegate-runtime":
      await undelegateRuntime(context, flags);
      return;
    case "settle-checkpoint":
      await settleCheckpoint(context, flags);
      return;
    case "call-endpoint":
      await callEndpoint(context, flags);
      return;
    case "revoke-key":
      await revokeKey(context, flags);
      return;
    case "view-audit":
      await viewAudit(context, flags);
      return;
    case "runtime-status":
      await runtimeStatus(context, flags);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
