import { parseArgs, requireFlag } from "./common";
import { probeMagicRouterEndpoint } from "./router-diagnostics";

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const endpoint =
    flags["magic-router"] ?? process.env.MAGIC_ROUTER_URL ?? requireFlag(flags, "magic-router");
  const strict = flags.strict === "true";
  const report = await probeMagicRouterEndpoint(endpoint);

  console.log(JSON.stringify(report, null, 2));

  if (strict) {
    const missing = [
      ["getIdentity", report.identity.ok],
      ["getBlockhashForAccounts", report.blockhashForAccounts.ok],
      ["getDelegationStatus", report.delegationStatus.ok],
    ].filter(([, ok]) => !ok);

    if (missing.length > 0) {
      throw new Error(
        `Router endpoint is missing required methods: ${missing.map(([name]) => name).join(", ")}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
