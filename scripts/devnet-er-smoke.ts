import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import {
  ACTIONS,
  PERMISSIONS,
  deriveApiKeyPda,
  deriveAuditCheckpointPda,
  deriveGatewayPda,
  deriveKeyId,
  deriveOrganizationPda,
  deriveQuotaPolicyPda,
  deriveQuotaRuntimePda,
  deriveRolePda,
  summarizeRuntimeHealth,
} from "../client/gatekeeper";
import {
  createContext,
  fetchMaybe,
  fetchRuntimeAccount,
  parseArgs,
  requireFlag,
  sendMethod,
} from "./common";

async function ensureGateway(context: ReturnType<typeof createContext>, gateway: PublicKey) {
  const existing = await fetchMaybe(() => (context.baseProgram.account as any).gateway.fetch(gateway));
  if (existing) {
    console.log("gateway exists");
    return;
  }

  const signature = await context.baseProgram.methods
    .initializeGateway()
    .accounts({
      gateway,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log(`gateway initialized: ${signature}`);
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const context = createContext(flags);
  if (!context.routerProgram) {
    throw new Error("Devnet ER smoke flow requires --magic-router or MAGIC_ROUTER_URL.");
  }

  const orgName = flags["org-name"] ?? process.env.GATEKEEPER_ORG ?? "devnet-acme";
  const roleName = flags["role-name"] ?? process.env.GATEKEEPER_ROLE ?? "metrics-reader";
  const keyMaterial =
    flags["key-material"] ?? process.env.GATEKEEPER_KEY_MATERIAL ?? "devnet-acme-key";
  const label = flags.label ?? "primary";
  const maxRequests = Number(flags["max-requests"] ?? 5);
  const windowSeconds = Number(flags["window-seconds"] ?? 60);
  const commitFrequencyMs = Number(flags["commit-frequency-ms"] ?? 500);
  const validator = flags.validator ? new PublicKey(flags.validator) : null;

  const gateway = deriveGatewayPda();
  const organization = deriveOrganizationPda(gateway, orgName);
  const role = deriveRolePda(organization, roleName);
  const keyId = deriveKeyId(keyMaterial);
  const apiKey = deriveApiKeyPda(organization, keyId);
  const quotaPolicy = deriveQuotaPolicyPda(apiKey);
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);
  const auditCheckpoint = deriveAuditCheckpointPda(apiKey);

  await ensureGateway(context, gateway);

  const organizationAccount = await fetchMaybe(() =>
    (context.baseProgram.account as any).organization.fetch(organization),
  );
  if (!organizationAccount) {
    const signature = await context.baseProgram.methods
      .createOrganization(orgName, context.wallet.publicKey)
      .accounts({
        gateway,
        organization,
        authority: context.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`organization created: ${signature}`);
  }

  const roleAccount = await fetchMaybe(() => (context.baseProgram.account as any).role.fetch(role));
  if (!roleAccount) {
    const signature = await context.baseProgram.methods
      .createRole(roleName)
      .accounts({
        organization,
        role,
        authority: context.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`role created: ${signature}`);
  }

  await context.baseProgram.methods
    .attachPolicyToRole(new anchor.BN(PERMISSIONS.metricsRead))
    .accounts({
      organization,
      role,
      authority: context.wallet.publicKey,
    })
    .rpc();
  console.log("policy attached");

  const apiKeyAccount = await fetchMaybe(() =>
    (context.baseProgram.account as any).apiKey.fetch(apiKey),
  );
  if (!apiKeyAccount) {
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
    console.log(`api key created: ${signature}`);
  }

  await context.baseProgram.methods
    .createQuotaPolicy(new anchor.BN(maxRequests), new anchor.BN(windowSeconds))
    .accounts({
      organization,
      apiKey,
      quotaPolicy,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log("quota policy configured");

  const runtimeAccount = await fetchMaybe(() =>
    (context.baseProgram.account as any).quotaRuntime.fetch(quotaRuntime),
  );
  if (!runtimeAccount) {
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
    console.log(`runtime initialized: ${signature}`);
  }

  const currentRuntime = await fetchRuntimeAccount(context, quotaRuntime);
  if (!currentRuntime.isDelegated) {
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
    console.log(`runtime delegated: ${signature}`);
  }

  const consumeMethods = context.routerProgram.methods.consumeRequest(ACTIONS.metricsRead).accounts({
    payer: context.wallet.publicKey,
    organization,
    role,
    apiKey,
    quotaPolicy,
    quotaRuntime,
  });
  const consumeSignature = await sendMethod(consumeMethods, context, true);
  console.log(`request admitted through router: ${consumeSignature}`);

  const commitMethods = context.routerProgram.methods.commitQuotaRuntime().accounts({
    organization,
    apiKey,
    quotaRuntime,
    authority: context.wallet.publicKey,
  });
  const commitSignature = await sendMethod(commitMethods, context, true);
  console.log(`runtime committed: ${commitSignature}`);

  const undelegateMethods = context.routerProgram.methods
    .commitAndUndelegateQuotaRuntime()
    .accounts({
      organization,
      apiKey,
      quotaRuntime,
      authority: context.wallet.publicKey,
    });
  const undelegateSignature = await sendMethod(undelegateMethods, context, true);
  console.log(`runtime undelegated: ${undelegateSignature}`);

  const settleSignature = await context.baseProgram.methods
    .settleRuntimeCheckpoint()
    .accounts({
      organization,
      apiKey,
      quotaRuntime,
      auditCheckpoint,
      authority: context.wallet.publicKey,
    })
    .rpc();
  console.log(`checkpoint settled: ${settleSignature}`);

  const finalRuntime = await fetchRuntimeAccount(context, quotaRuntime);
  const finalCheckpoint = await (context.baseProgram.account as any).auditCheckpoint.fetch(
    auditCheckpoint,
  );
  const health = summarizeRuntimeHealth(finalRuntime, finalCheckpoint);
  console.log(JSON.stringify(health, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
