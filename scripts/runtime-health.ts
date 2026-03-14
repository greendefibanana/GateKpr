import {
  reasonLabel,
  summarizeRuntimeHealth,
  toNumber,
} from "../client/gatekeeper";
import { createContext, fetchRuntimeAccount, parseArgs, resolveAddresses } from "./common";

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const context = createContext(flags);
  const { organization, apiKey, quotaRuntime, auditCheckpoint } = resolveAddresses(flags);

  const runtimeAccount = await fetchRuntimeAccount(context, quotaRuntime);
  const checkpointAccount = await (context.baseProgram.account as any).auditCheckpoint.fetch(
    auditCheckpoint,
  );
  const apiKeyAccount = await (context.baseProgram.account as any).apiKey.fetch(apiKey);
  const health = summarizeRuntimeHealth(runtimeAccount, checkpointAccount);

  const payload = {
    organization: organization.toBase58(),
    apiKey: apiKey.toBase58(),
    quotaRuntime: quotaRuntime.toBase58(),
    auditCheckpoint: auditCheckpoint.toBase58(),
    active: Boolean(apiKeyAccount.active),
    delegatedValidator: runtimeAccount.delegatedValidator.toBase58(),
    commitFrequencyMs: toNumber(runtimeAccount.commitFrequencyMs),
    health,
    rollingAudit: runtimeAccount.rollingAudit.map((entry: any) => ({
      sequence: toNumber(entry.sequence),
      action: entry.action,
      allowed: entry.allowed,
      reason: reasonLabel(entry.reason),
      timestamp: toNumber(entry.timestamp),
      quotaUsedAfter: toNumber(entry.quotaUsedAfter),
    })),
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
