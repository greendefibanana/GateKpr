import {
  summarizeRuntimeHealth,
  toNumber,
} from "../client/gatekeeper";
import {
  createContext,
  fetchRuntimeAccount,
  parseArgs,
  resolveAddresses,
  sendMethod,
} from "./common";

type Mode = "status" | "commit-only" | "undelegate-and-settle" | "settle-if-safe";

function resolveMode(rawMode: string | undefined): Mode {
  switch (rawMode) {
    case undefined:
    case "status":
      return "status";
    case "commit-only":
      return "commit-only";
    case "undelegate-and-settle":
      return "undelegate-and-settle";
    case "settle-if-safe":
      return "settle-if-safe";
    default:
      throw new Error(`Unsupported reconcile mode: ${rawMode}`);
  }
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const mode = resolveMode(flags.mode);
  const context = createContext(flags);
  const { organization, apiKey, quotaRuntime, auditCheckpoint } = resolveAddresses(flags);

  const loadHealth = async () => {
    const runtimeAccount = await fetchRuntimeAccount(context, quotaRuntime);
    const checkpointAccount = await (context.baseProgram.account as any).auditCheckpoint.fetch(
      auditCheckpoint,
    );
    return {
      runtimeAccount,
      checkpointAccount,
      health: summarizeRuntimeHealth(runtimeAccount, checkpointAccount),
    };
  };

  const before = await loadHealth();
  console.log(`before: ${JSON.stringify(before.health)}`);

  switch (mode) {
    case "status":
      break;
    case "commit-only": {
      if (!before.health.delegated) {
        throw new Error("Runtime is not delegated; commit-only is not applicable.");
      }
      const methods = context.routerProgram.methods.commitQuotaRuntime().accounts({
        organization,
        apiKey,
        quotaRuntime,
        authority: context.wallet.publicKey,
      });
      const signature = await sendMethod(methods, context, true);
      console.log(`commit signature: ${signature}`);
      break;
    }
    case "undelegate-and-settle": {
      if (before.health.delegated) {
        const undelegateMethods = context.routerProgram.methods
          .commitAndUndelegateQuotaRuntime()
          .accounts({
            organization,
            apiKey,
            quotaRuntime,
            authority: context.wallet.publicKey,
          });
        const undelegateSignature = await sendMethod(undelegateMethods, context, true);
        console.log(`undelegate signature: ${undelegateSignature}`);
      }

      const afterUndelegate = await loadHealth();
      if (afterUndelegate.health.delegated) {
        throw new Error("Runtime still appears delegated after commit+undelegate.");
      }

      if (afterUndelegate.health.drift > 0) {
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
        console.log(`settle signature: ${settleSignature}`);
      }
      break;
    }
    case "settle-if-safe": {
      if (before.health.delegated) {
        throw new Error(
          "Runtime is delegated; use --mode undelegate-and-settle after routing through Magic Router.",
        );
      }

      if (before.health.drift === 0) {
        console.log("No unsettled drift detected.");
        break;
      }

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
      console.log(`settle signature: ${settleSignature}`);
      break;
    }
  }

  const after = await loadHealth();
  console.log(`after: ${JSON.stringify(after.health)}`);
  console.log(
    `summary: delegated=${after.health.delegated} drift=${after.health.drift} rolling_sequence=${toNumber(after.runtimeAccount.rollingSequence)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
