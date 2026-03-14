import * as anchor from "@coral-xyz/anchor";

import {
  ACTIONS,
  DECISION_REASONS,
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
  toNumber,
} from "../client/gatekeeper";
import { createContext, fetchMaybe, parseArgs } from "./common";

type TenantContext = {
  organizationName: string;
  roleName: string;
  keyMaterial: string;
  label: string;
  permissionMask: number;
  maxRequests: number;
  windowSeconds: number;
  organization: anchor.web3.PublicKey;
  role: anchor.web3.PublicKey;
  apiKey: anchor.web3.PublicKey;
  quotaPolicy: anchor.web3.PublicKey;
  quotaRuntime: anchor.web3.PublicKey;
  auditCheckpoint: anchor.web3.PublicKey;
};

type RecordedStep = {
  application: string;
  status: "passed";
  signature?: string;
  notes: string[];
};

function buildTenant(
  organizationName: string,
  roleName: string,
  keyMaterial: string,
  label: string,
  permissionMask: number,
  maxRequests: number,
  windowSeconds: number,
): TenantContext {
  const gateway = deriveGatewayPda();
  const keyId = deriveKeyId(keyMaterial);
  const organization = deriveOrganizationPda(gateway, organizationName);
  const role = deriveRolePda(organization, roleName);
  const apiKey = deriveApiKeyPda(organization, keyId);
  const quotaPolicy = deriveQuotaPolicyPda(apiKey);
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);
  const auditCheckpoint = deriveAuditCheckpointPda(apiKey);

  return {
    organizationName,
    roleName,
    keyMaterial,
    label,
    permissionMask,
    maxRequests,
    windowSeconds,
    organization,
    role,
    apiKey,
    quotaPolicy,
    quotaRuntime,
    auditCheckpoint,
  };
}

async function ensureGateway(context: ReturnType<typeof createContext>) {
  const gateway = deriveGatewayPda();
  const existing = await fetchMaybe(() => (context.baseProgram.account as any).gateway.fetch(gateway));
  if (existing) {
    return { gateway, signature: null as string | null, created: false };
  }

  const signature = await context.baseProgram.methods
    .initializeGateway()
    .accounts({
      gateway,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  return { gateway, signature, created: true };
}

async function ensureTenant(
  context: ReturnType<typeof createContext>,
  tenant: TenantContext,
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {
    organization: null,
    role: null,
    policy: null,
    apiKey: null,
    quotaPolicy: null,
    runtime: null,
  };

  const organizationAccount = await fetchMaybe(() =>
    (context.baseProgram.account as any).organization.fetch(tenant.organization),
  );
  if (!organizationAccount) {
    result.organization = await context.baseProgram.methods
      .createOrganization(tenant.organizationName, context.wallet.publicKey)
      .accounts({
        gateway: deriveGatewayPda(),
        organization: tenant.organization,
        authority: context.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  }

  const roleAccount = await fetchMaybe(() =>
    (context.baseProgram.account as any).role.fetch(tenant.role),
  );
  if (!roleAccount) {
    result.role = await context.baseProgram.methods
      .createRole(tenant.roleName)
      .accounts({
        organization: tenant.organization,
        role: tenant.role,
        authority: context.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  }

  result.policy = await context.baseProgram.methods
    .attachPolicyToRole(new anchor.BN(tenant.permissionMask))
    .accounts({
      organization: tenant.organization,
      role: tenant.role,
      authority: context.wallet.publicKey,
    })
    .rpc();

  const apiKeyAccount = await fetchMaybe(() =>
    (context.baseProgram.account as any).apiKey.fetch(tenant.apiKey),
  );
  if (!apiKeyAccount) {
    result.apiKey = await context.baseProgram.methods
      .createApiKey(deriveKeyId(tenant.keyMaterial), tenant.label)
      .accounts({
        organization: tenant.organization,
        role: tenant.role,
        apiKey: tenant.apiKey,
        authority: context.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  }

  result.quotaPolicy = await context.baseProgram.methods
    .createQuotaPolicy(new anchor.BN(tenant.maxRequests), new anchor.BN(tenant.windowSeconds))
    .accounts({
      organization: tenant.organization,
      apiKey: tenant.apiKey,
      quotaPolicy: tenant.quotaPolicy,
      authority: context.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const runtimeAccount = await fetchMaybe(() =>
    (context.baseProgram.account as any).quotaRuntime.fetch(tenant.quotaRuntime),
  );
  if (!runtimeAccount) {
    result.runtime = await context.baseProgram.methods
      .initializeQuotaRuntime()
      .accounts({
        organization: tenant.organization,
        apiKey: tenant.apiKey,
        quotaPolicy: tenant.quotaPolicy,
        quotaRuntime: tenant.quotaRuntime,
        auditCheckpoint: tenant.auditCheckpoint,
        authority: context.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  }

  return result;
}

async function consume(
  context: ReturnType<typeof createContext>,
  tenant: TenantContext,
  action: number,
) {
  return context.baseProgram.methods
    .consumeRequest(action)
    .accounts({
      payer: context.wallet.publicKey,
      organization: tenant.organization,
      role: tenant.role,
      apiKey: tenant.apiKey,
      quotaPolicy: tenant.quotaPolicy,
      quotaRuntime: tenant.quotaRuntime,
    })
    .rpc();
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const context = createContext(flags);
  const runId = flags["run-id"] ?? `${Math.floor(Date.now() / 1000)}`;

  const acme = buildTenant(
    `acme-${runId}`,
    "metrics-reader",
    `acme-dashboard-key-${runId}`,
    "dashboard",
    PERMISSIONS.metricsRead,
    2,
    60,
  );
  const globex = buildTenant(
    `globex-${runId}`,
    "ops-admin",
    `globex-ops-key-${runId}`,
    "ops-console",
    PERMISSIONS.admin,
    5,
    60,
  );

  const steps: RecordedStep[] = [];
  const gatewayInfo = await ensureGateway(context);
  steps.push({
    application: "Shared control plane bootstrap",
    status: "passed",
    signature: gatewayInfo.signature ?? undefined,
    notes: [`gateway=${gatewayInfo.gateway.toBase58()}`, `created=${gatewayInfo.created}`],
  });

  const acmeSetup = await ensureTenant(context, acme);
  const globexSetup = await ensureTenant(context, globex);
  steps.push({
    application: "Multi-tenant SaaS onboarding",
    status: "passed",
    signature: acmeSetup.organization ?? globexSetup.organization ?? undefined,
    notes: [
      `acme_org=${acme.organization.toBase58()}`,
      `globex_org=${globex.organization.toBase58()}`,
      `acme_key=${acme.apiKey.toBase58()}`,
      `globex_key=${globex.apiKey.toBase58()}`,
    ],
  });

  const allowSig = await consume(context, acme, ACTIONS.metricsRead);
  const denySig = await consume(context, acme, ACTIONS.usersWrite);
  let acmeRuntime = await (context.baseProgram.account as any).quotaRuntime.fetch(acme.quotaRuntime);
  if (
    toNumber(acmeRuntime.totalAllowed) !== 1 ||
    toNumber(acmeRuntime.totalRejected) !== 1 ||
    acmeRuntime.rollingAudit[1].reason !== DECISION_REASONS.unauthorized
  ) {
    throw new Error("RBAC scenario did not produce the expected allow/deny pattern.");
  }
  steps.push({
    application: "API gateway RBAC enforcement",
    status: "passed",
    signature: denySig,
    notes: [`allowed_sig=${allowSig}`, "acme metrics:read allowed", "acme users:write rejected"],
  });

  const withinQuotaSig = await consume(context, acme, ACTIONS.metricsRead);
  const overQuotaSig = await consume(context, acme, ACTIONS.metricsRead);
  acmeRuntime = await (context.baseProgram.account as any).quotaRuntime.fetch(acme.quotaRuntime);
  if (
    toNumber(acmeRuntime.currentWindowUsed) !== 2 ||
    toNumber(acmeRuntime.totalAllowed) !== 2 ||
    toNumber(acmeRuntime.totalRejected) !== 2 ||
    acmeRuntime.rollingAudit[3].reason !== DECISION_REASONS.quotaExceeded
  ) {
    throw new Error("Quota scenario did not produce the expected exhausted-window state.");
  }
  steps.push({
    application: "Per-key rate limiting",
    status: "passed",
    signature: overQuotaSig,
    notes: [`within_quota_sig=${withinQuotaSig}`, "quota limit reached on third permitted request"],
  });

  const globexSig = await consume(context, globex, ACTIONS.usersWrite);
  const globexRuntime = await (context.baseProgram.account as any).quotaRuntime.fetch(globex.quotaRuntime);
  if (
    toNumber(globexRuntime.totalAllowed) !== 1 ||
    toNumber(globexRuntime.totalRejected) !== 0
  ) {
    throw new Error("Tenant isolation scenario did not preserve independent Globex runtime state.");
  }
  steps.push({
    application: "Tenant isolation",
    status: "passed",
    signature: globexSig,
    notes: ["globex users:write allowed", "globex runtime unaffected by acme quota exhaustion"],
  });

  const settleSig = await context.baseProgram.methods
    .settleRuntimeCheckpoint()
    .accounts({
      organization: acme.organization,
      apiKey: acme.apiKey,
      quotaRuntime: acme.quotaRuntime,
      auditCheckpoint: acme.auditCheckpoint,
      authority: context.wallet.publicKey,
    })
    .rpc();
  acmeRuntime = await (context.baseProgram.account as any).quotaRuntime.fetch(acme.quotaRuntime);
  const acmeCheckpoint = await (context.baseProgram.account as any).auditCheckpoint.fetch(
    acme.auditCheckpoint,
  );
  if (
    acmeRuntime.rollingAudit.length !== 0 ||
    toNumber(acmeCheckpoint.settledSequence) !== 4 ||
    toNumber(acmeCheckpoint.totalAllowed) !== 2 ||
    toNumber(acmeCheckpoint.totalRejected) !== 2
  ) {
    throw new Error("Audit settlement scenario did not compact runtime state into the checkpoint.");
  }
  steps.push({
    application: "Audit checkpointing",
    status: "passed",
    signature: settleSig,
    notes: ["acme runtime audit buffer cleared", "checkpoint totals settled to 2 allowed / 2 rejected"],
  });

  const revokeSig = await context.baseProgram.methods
    .revokeApiKey()
    .accounts({
      organization: acme.organization,
      apiKey: acme.apiKey,
      authority: context.wallet.publicKey,
    })
    .rpc();
  const revokedCallSig = await consume(context, acme, ACTIONS.metricsRead);
  acmeRuntime = await (context.baseProgram.account as any).quotaRuntime.fetch(acme.quotaRuntime);
  if (
    toNumber(acmeRuntime.totalRejected) !== 3 ||
    acmeRuntime.rollingAudit[0].reason !== DECISION_REASONS.keyRevoked
  ) {
    throw new Error("Revocation scenario did not reject the disabled API key.");
  }
  steps.push({
    application: "Credential revocation",
    status: "passed",
    signature: revokedCallSig,
    notes: [`revoke_sig=${revokeSig}`, "revoked acme key rejected on next request"],
  });

  const health = summarizeRuntimeHealth(acmeRuntime, acmeCheckpoint);
  const report = {
    runId,
    cluster: context.baseProvider.connection.rpcEndpoint,
    wallet: context.wallet.publicKey.toBase58(),
    programId: context.baseProgram.programId.toBase58(),
    steps,
    finalState: {
      acme: {
        organization: acme.organization.toBase58(),
        apiKey: acme.apiKey.toBase58(),
        quotaRuntime: acme.quotaRuntime.toBase58(),
        auditCheckpoint: acme.auditCheckpoint.toBase58(),
        totalAllowed: toNumber(acmeRuntime.totalAllowed),
        totalRejected: toNumber(acmeRuntime.totalRejected),
        rollingSequence: toNumber(acmeRuntime.rollingSequence),
        settledSequence: toNumber(acmeCheckpoint.settledSequence),
        currentWindowUsed: toNumber(acmeRuntime.currentWindowUsed),
        latestReason: acmeRuntime.rollingAudit[0]?.reason ?? null,
        health,
      },
      globex: {
        organization: globex.organization.toBase58(),
        apiKey: globex.apiKey.toBase58(),
        quotaRuntime: globex.quotaRuntime.toBase58(),
        totalAllowed: toNumber(globexRuntime.totalAllowed),
        totalRejected: toNumber(globexRuntime.totalRejected),
        rollingSequence: toNumber(globexRuntime.rollingSequence),
      },
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
