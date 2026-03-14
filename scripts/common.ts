import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { join } from "node:path";

import {
  MAGIC_ROUTER_ENV,
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
  sendThroughMagicRouter,
} from "../client/gatekeeper";

export type ParsedArgs = {
  command?: string;
  flags: Record<string, string>;
};

export type OpsContext = {
  wallet: anchor.Wallet;
  baseProvider: anchor.AnchorProvider;
  baseProgram: any;
  routerConnection: Connection | null;
  routerProvider: anchor.AnchorProvider | null;
  routerProgram: any | null;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const [maybeCommand, ...rest] = argv;
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

  if (maybeCommand?.startsWith("--") || !maybeCommand) {
    if (maybeCommand?.startsWith("--")) {
      const key = maybeCommand.slice(2);
      const nextValue = rest[0];
      if (!nextValue || nextValue.startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = nextValue;
      }
    }

    return { flags };
  }

  return { command: maybeCommand, flags };
}

export function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

export function createContext(flags: Record<string, string>): OpsContext {
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

export async function sendMethod(
  methods: any,
  context: OpsContext,
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

export async function fetchRuntimeAccount(
  context: OpsContext,
  quotaRuntime: PublicKey,
): Promise<any> {
  if (context.routerProgram) {
    try {
      return await (context.routerProgram.account as any).quotaRuntime.fetch(quotaRuntime);
    } catch {
      // Fall back to base RPC when the router is unavailable or out of sync.
    }
  }

  return (context.baseProgram.account as any).quotaRuntime.fetch(quotaRuntime);
}

export function resolveAddresses(flags: Record<string, string>) {
  const gateway = deriveGatewayPda();
  const orgName = requireFlag(flags, "org-name");
  const material = requireFlag(flags, "key-material");
  const organization = deriveOrganizationPda(gateway, orgName);
  const apiKey = deriveApiKeyPda(organization, deriveKeyId(material));
  const quotaPolicy = deriveQuotaPolicyPda(apiKey);
  const quotaRuntime = deriveQuotaRuntimePda(apiKey);
  const auditCheckpoint = deriveAuditCheckpointPda(apiKey);
  const roleName = flags["role-name"];
  const role = roleName ? deriveRolePda(organization, roleName) : null;

  return {
    gateway,
    orgName,
    material,
    organization,
    apiKey,
    quotaPolicy,
    quotaRuntime,
    auditCheckpoint,
    role,
  };
}

export async function fetchMaybe(fetcher: () => Promise<any>): Promise<any | null> {
  try {
    return await fetcher();
  } catch {
    return null;
  }
}
