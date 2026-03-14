import * as anchor from "@coral-xyz/anchor";
import assert from "node:assert/strict";
import { join } from "node:path";

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
  getProgram,
  readWallet,
  toNumber,
} from "../client/gatekeeper";

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

async function provisionTenant(
  program: any,
  authority: anchor.web3.PublicKey,
  tenant: TenantContext,
): Promise<void> {
  await program.methods
    .createOrganization(tenant.organizationName, authority)
    .accounts({
      gateway: deriveGatewayPda(),
      organization: tenant.organization,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .createRole(tenant.roleName)
    .accounts({
      organization: tenant.organization,
      role: tenant.role,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .attachPolicyToRole(new anchor.BN(tenant.permissionMask))
    .accounts({
      organization: tenant.organization,
      role: tenant.role,
      authority,
    })
    .rpc();

  await program.methods
    .createApiKey(deriveKeyId(tenant.keyMaterial), tenant.label)
    .accounts({
      organization: tenant.organization,
      role: tenant.role,
      apiKey: tenant.apiKey,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .createQuotaPolicy(new anchor.BN(tenant.maxRequests), new anchor.BN(tenant.windowSeconds))
    .accounts({
      organization: tenant.organization,
      apiKey: tenant.apiKey,
      quotaPolicy: tenant.quotaPolicy,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .initializeQuotaRuntime()
    .accounts({
      organization: tenant.organization,
      apiKey: tenant.apiKey,
      quotaPolicy: tenant.quotaPolicy,
      quotaRuntime: tenant.quotaRuntime,
      auditCheckpoint: tenant.auditCheckpoint,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
}

async function consume(
  program: any,
  authority: anchor.web3.PublicKey,
  tenant: TenantContext,
  action: number,
): Promise<void> {
  await program.methods
    .consumeRequest(action)
    .accounts({
      payer: authority,
      organization: tenant.organization,
      role: tenant.role,
      apiKey: tenant.apiKey,
      quotaPolicy: tenant.quotaPolicy,
      quotaRuntime: tenant.quotaRuntime,
    })
    .rpc();
}

async function main() {
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899",
    "confirmed",
  );
  const wallet = readWallet(
    process.env.ANCHOR_WALLET ?? join(process.cwd(), "wallets", "localnet-authority.json"),
  );
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const authority = provider.wallet.publicKey;
  const program: any = getProgram(provider);
  const accounts = program.account as any;
  const gateway = deriveGatewayPda();
  const runId = `${Math.floor(Date.now() / 1000)}`;

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

  console.log("1. gateway bootstraps the control plane");
  await program.methods
    .initializeGateway()
    .accounts({
      gateway,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const gatewayAccount = await accounts.gateway.fetch(gateway);
  assert.equal(gatewayAccount.authority.toBase58(), authority.toBase58());

  console.log("2. two tenants onboard independently");
  await provisionTenant(program, authority, acme);
  await provisionTenant(program, authority, globex);

  const acmeOrg = await accounts.organization.fetch(acme.organization);
  const globexOrg = await accounts.organization.fetch(globex.organization);
  const updatedGateway = await accounts.gateway.fetch(gateway);
  assert.equal(acmeOrg.name, acme.organizationName);
  assert.equal(globexOrg.name, globex.organizationName);
  assert.equal(toNumber(updatedGateway.organizationCount), 2);

  console.log("3. RBAC behaves like an API gateway permission layer");
  await consume(program, authority, acme, ACTIONS.metricsRead);
  await consume(program, authority, acme, ACTIONS.usersWrite);

  let acmeRuntime = await accounts.quotaRuntime.fetch(acme.quotaRuntime);
  assert.equal(toNumber(acmeRuntime.totalAllowed), 1);
  assert.equal(toNumber(acmeRuntime.totalRejected), 1);
  assert.equal(acmeRuntime.rollingAudit[0].allowed, true);
  assert.equal(acmeRuntime.rollingAudit[1].reason, DECISION_REASONS.unauthorized);

  console.log("4. per-key quota acts like on-chain rate limiting");
  await consume(program, authority, acme, ACTIONS.metricsRead);
  await consume(program, authority, acme, ACTIONS.metricsRead);

  acmeRuntime = await accounts.quotaRuntime.fetch(acme.quotaRuntime);
  assert.equal(toNumber(acmeRuntime.currentWindowUsed), 2);
  assert.equal(toNumber(acmeRuntime.totalAllowed), 2);
  assert.equal(toNumber(acmeRuntime.totalRejected), 2);
  assert.equal(acmeRuntime.rollingAudit[3].reason, DECISION_REASONS.quotaExceeded);

  console.log("5. another tenant remains isolated from Acme traffic");
  await consume(program, authority, globex, ACTIONS.usersWrite);

  const globexRuntime = await accounts.quotaRuntime.fetch(globex.quotaRuntime);
  assert.equal(toNumber(globexRuntime.totalAllowed), 1);
  assert.equal(toNumber(globexRuntime.totalRejected), 0);
  assert.equal(toNumber(globexRuntime.currentWindowUsed), 1);

  console.log("6. settlement compacts runtime state into durable audit state");
  await program.methods
    .settleRuntimeCheckpoint()
    .accounts({
      organization: acme.organization,
      apiKey: acme.apiKey,
      quotaRuntime: acme.quotaRuntime,
      auditCheckpoint: acme.auditCheckpoint,
      authority,
    })
    .rpc();

  acmeRuntime = await accounts.quotaRuntime.fetch(acme.quotaRuntime);
  const acmeCheckpoint = await accounts.auditCheckpoint.fetch(acme.auditCheckpoint);
  assert.equal(acmeRuntime.rollingAudit.length, 0);
  assert.equal(toNumber(acmeCheckpoint.settledSequence), 4);
  assert.equal(toNumber(acmeCheckpoint.totalAllowed), 2);
  assert.equal(toNumber(acmeCheckpoint.totalRejected), 2);

  console.log("7. revocation blocks a compromised credential immediately");
  await program.methods
    .revokeApiKey()
    .accounts({
      organization: acme.organization,
      apiKey: acme.apiKey,
      authority,
    })
    .rpc();

  await consume(program, authority, acme, ACTIONS.metricsRead);

  acmeRuntime = await accounts.quotaRuntime.fetch(acme.quotaRuntime);
  assert.equal(toNumber(acmeRuntime.totalRejected), 3);
  assert.equal(acmeRuntime.rollingAudit[0].reason, DECISION_REASONS.keyRevoked);

  console.log("8. final demo summary");
  console.log(
    JSON.stringify(
      {
        gateway: gateway.toBase58(),
        tenants: [
          {
            name: acme.organizationName,
            organization: acme.organization.toBase58(),
            apiKey: acme.apiKey.toBase58(),
            checkpoint: acme.auditCheckpoint.toBase58(),
            settledAllowed: toNumber(acmeCheckpoint.totalAllowed),
            settledRejected: toNumber(acmeCheckpoint.totalRejected),
            latestRuntimeReason: acmeRuntime.rollingAudit[0]?.reason,
          },
          {
            name: globex.organizationName,
            organization: globex.organization.toBase58(),
            apiKey: globex.apiKey.toBase58(),
            runtimeAllowed: toNumber(globexRuntime.totalAllowed),
            runtimeRejected: toNumber(globexRuntime.totalRejected),
          },
        ],
      },
      null,
      2,
    ),
  );

  console.log("Web2-style Gatekeeper demo passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
