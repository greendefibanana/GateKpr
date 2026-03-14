import * as anchor from "@coral-xyz/anchor";
import assert from "node:assert/strict";

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
  reasonLabel,
  toNumber,
} from "../client/gatekeeper";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program: any = getProgram(provider);
  const accounts = program.account as any;
  const gateway = deriveGatewayPda();
  const organizationName = "acme";
  const roleName = "metrics-reader";
  const keyMaterial = "acme-key-1";
  const keyId = deriveKeyId(keyMaterial);
  const organization = deriveOrganizationPda(gateway, organizationName);
  const role = deriveRolePda(organization, roleName);
  const apiKey = deriveApiKeyPda(organization, keyId);
  const quotaPolicy = deriveQuotaPolicyPda(apiKey);
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);
  const auditCheckpoint = deriveAuditCheckpointPda(apiKey);
  const authority = provider.wallet.publicKey;

  console.log("1. initialize gateway successfully");
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

  console.log("2. create organization successfully");
  await program.methods
    .createOrganization(organizationName, authority)
    .accounts({
      gateway,
      organization,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const organizationAccount = await accounts.organization.fetch(organization);
  assert.equal(organizationAccount.name, organizationName);

  console.log("3. create role successfully");
  await program.methods
    .createRole(roleName)
    .accounts({
      organization,
      role,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .attachPolicyToRole(new anchor.BN(PERMISSIONS.metricsRead))
    .accounts({
      organization,
      role,
      authority,
    })
    .rpc();

  const roleAccount = await accounts.role.fetch(role);
  assert.equal(toNumber(roleAccount.policyMask), PERMISSIONS.metricsRead);

  console.log("4. create api key successfully");
  await program.methods
    .createApiKey(keyId, "primary")
    .accounts({
      organization,
      role,
      apiKey,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("5. create quota policy successfully");
  await program.methods
    .createQuotaPolicy(new anchor.BN(2), new anchor.BN(60))
    .accounts({
      organization,
      apiKey,
      quotaPolicy,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const quotaPolicyAccount = await accounts.quotaPolicy.fetch(quotaPolicy);
  assert.equal(toNumber(quotaPolicyAccount.maxRequests), 2);
  assert.equal(toNumber(quotaPolicyAccount.windowSeconds), 60);

  console.log("6. initialize runtime and checkpoint");
  await program.methods
    .initializeQuotaRuntime()
    .accounts({
      organization,
      apiKey,
      quotaPolicy,
      quotaRuntime,
      auditCheckpoint,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  let runtimeAccount = await accounts.quotaRuntime.fetch(quotaRuntime);
  let checkpointAccount = await accounts.auditCheckpoint.fetch(auditCheckpoint);
  assert.equal(runtimeAccount.isDelegated, false);
  assert.equal(runtimeAccount.rollingAudit.length, 0);
  assert.equal(toNumber(checkpointAccount.settledSequence), 0);

  console.log("7. authorized request succeeds in plain Solana mode");
  await program.methods
    .consumeRequest(ACTIONS.metricsRead)
    .accounts({
      payer: authority,
      organization,
      role,
      apiKey,
      quotaPolicy,
      quotaRuntime,
    })
    .rpc();

  runtimeAccount = await accounts.quotaRuntime.fetch(quotaRuntime);
  assert.equal(toNumber(runtimeAccount.currentWindowUsed), 1);
  assert.equal(toNumber(runtimeAccount.rollingSequence), 1);
  assert.equal(runtimeAccount.rollingAudit[0].allowed, true);

  console.log("8. unauthorized request is rejected in runtime state");
  await program.methods
    .consumeRequest(ACTIONS.usersWrite)
    .accounts({
      payer: authority,
      organization,
      role,
      apiKey,
      quotaPolicy,
      quotaRuntime,
    })
    .rpc();

  runtimeAccount = await accounts.quotaRuntime.fetch(quotaRuntime);
  assert.equal(toNumber(runtimeAccount.currentWindowUsed), 1);
  assert.equal(toNumber(runtimeAccount.rollingSequence), 2);
  assert.equal(runtimeAccount.rollingAudit[1].allowed, false);
  assert.equal(runtimeAccount.rollingAudit[1].reason, DECISION_REASONS.unauthorized);

  console.log("9. quota exceeded is rejected");
  await program.methods
    .consumeRequest(ACTIONS.metricsRead)
    .accounts({
      payer: authority,
      organization,
      role,
      apiKey,
      quotaPolicy,
      quotaRuntime,
    })
    .rpc();

  await program.methods
    .consumeRequest(ACTIONS.metricsRead)
    .accounts({
      payer: authority,
      organization,
      role,
      apiKey,
      quotaPolicy,
      quotaRuntime,
    })
    .rpc();

  runtimeAccount = await accounts.quotaRuntime.fetch(quotaRuntime);
  assert.equal(toNumber(runtimeAccount.currentWindowUsed), 2);
  assert.equal(runtimeAccount.rollingAudit[3].allowed, false);
  assert.equal(runtimeAccount.rollingAudit[3].reason, DECISION_REASONS.quotaExceeded);

  console.log("10. expired runtime window resets with a short policy");
  await program.methods
    .createQuotaPolicy(new anchor.BN(2), new anchor.BN(1))
    .accounts({
      organization,
      apiKey,
      quotaPolicy,
      authority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .consumeRequest(ACTIONS.metricsRead)
    .accounts({
      payer: authority,
      organization,
      role,
      apiKey,
      quotaPolicy,
      quotaRuntime,
    })
    .rpc();

  await new Promise((resolve) => setTimeout(resolve, 1200));
  await program.methods
    .consumeRequest(ACTIONS.metricsRead)
    .accounts({
      payer: authority,
      organization,
      role,
      apiKey,
      quotaPolicy,
      quotaRuntime,
    })
    .rpc();

  runtimeAccount = await accounts.quotaRuntime.fetch(quotaRuntime);
  assert.equal(toNumber(runtimeAccount.currentWindowUsed), 1);
  assert.equal(toNumber(runtimeAccount.totalAllowed), 4);
  assert.equal(toNumber(runtimeAccount.totalRejected), 2);

  console.log("11. settle checkpoint copies runtime totals and clears the rolling buffer");
  await program.methods
    .settleRuntimeCheckpoint()
    .accounts({
      organization,
      apiKey,
      quotaRuntime,
      auditCheckpoint,
      authority,
    })
    .rpc();

  runtimeAccount = await accounts.quotaRuntime.fetch(quotaRuntime);
  checkpointAccount = await accounts.auditCheckpoint.fetch(auditCheckpoint);
  const settledOrganization = await accounts.organization.fetch(organization);
  assert.equal(runtimeAccount.rollingAudit.length, 0);
  assert.equal(toNumber(runtimeAccount.lastSettledSequence), 6);
  assert.equal(toNumber(checkpointAccount.settledSequence), 6);
  assert.equal(toNumber(checkpointAccount.totalAllowed), 4);
  assert.equal(toNumber(checkpointAccount.totalRejected), 2);
  assert.equal(toNumber(settledOrganization.settlementCount), 1);

  console.log("12. invalid action is recorded without consuming quota");
  await program.methods
    .consumeRequest(99)
    .accounts({
      payer: authority,
      organization,
      role,
      apiKey,
      quotaPolicy,
      quotaRuntime,
    })
    .rpc();

  runtimeAccount = await accounts.quotaRuntime.fetch(quotaRuntime);
  assert.equal(toNumber(runtimeAccount.rollingSequence), 7);
  assert.equal(runtimeAccount.rollingAudit.length, 1);
  assert.equal(runtimeAccount.rollingAudit[0].reason, DECISION_REASONS.invalidAction);
  assert.equal(toNumber(runtimeAccount.currentWindowUsed), 1);

  console.log("13. rolling audit buffer caps at eight entries");
  for (let index = 0; index < 8; index += 1) {
    await program.methods
      .consumeRequest(99)
      .accounts({
        payer: authority,
        organization,
        role,
        apiKey,
        quotaPolicy,
        quotaRuntime,
      })
      .rpc();
  }

  runtimeAccount = await accounts.quotaRuntime.fetch(quotaRuntime);
  assert.equal(toNumber(runtimeAccount.rollingSequence), 15);
  assert.equal(runtimeAccount.rollingAudit.length, 8);
  assert.equal(toNumber(runtimeAccount.rollingAudit[0].sequence), 8);
  assert.equal(toNumber(runtimeAccount.totalRejected), 11);

  console.log("14. revoked key is still rejected after checkpoint settlement");
  await program.methods
    .revokeApiKey()
    .accounts({
      organization,
      apiKey,
      authority,
    })
    .rpc();

  await program.methods
    .consumeRequest(ACTIONS.metricsRead)
    .accounts({
      payer: authority,
      organization,
      role,
      apiKey,
      quotaPolicy,
      quotaRuntime,
    })
    .rpc();

  runtimeAccount = await accounts.quotaRuntime.fetch(quotaRuntime);
  assert.equal(toNumber(runtimeAccount.rollingSequence), 16);
  assert.equal(runtimeAccount.rollingAudit.length, 8);
  assert.equal(runtimeAccount.rollingAudit[7].reason, DECISION_REASONS.keyRevoked);

  console.log("Runtime rolling audit");
  for (const entry of runtimeAccount.rollingAudit) {
    console.log(
      `runtime seq=${toNumber(entry.sequence)} action=${entry.action} allowed=${entry.allowed} reason=${reasonLabel(entry.reason)}`,
    );
  }

  console.log("Checkpoint summary");
  console.log(
    `checkpoint seq=${toNumber(checkpointAccount.settledSequence)} allowed=${toNumber(checkpointAccount.totalAllowed)} rejected=${toNumber(checkpointAccount.totalRejected)}`,
  );

  console.log("All Gatekeeper runtime scenarios passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
