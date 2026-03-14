import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { sendMagicTransaction } from "magic-router-sdk";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROGRAM_ID = new PublicKey(
  "5UetKs63bZxoYy5dZvJxYjUSTBmaF5tN7ADR8pB6SMZu",
);

export const MAGIC_ROUTER_ENV = "MAGIC_ROUTER_URL";
export const IDL_PATH_ENV = "GATEKEEPER_IDL_PATH";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export type RuntimeHealth = {
  delegated: boolean;
  rollingSequence: number;
  settledSequence: number;
  drift: number;
  rollingAuditEntries: number;
  currentWindowUsed: number;
  totalAllowed: number;
  totalRejected: number;
  recommendedAction: "none" | "commit" | "undelegate_and_settle" | "settle";
  notes: string[];
};

export const ACTIONS = {
  metricsRead: 0,
  metricsWrite: 1,
  usersRead: 2,
  usersWrite: 3,
  admin: 4,
} as const;

export const PERMISSIONS = {
  metricsRead: 1 << 0,
  metricsWrite: 1 << 1,
  usersRead: 1 << 2,
  usersWrite: 1 << 3,
  admin: 1 << 4,
} as const;

export const DECISION_REASONS = {
  allowed: 0,
  unauthorized: 1,
  keyRevoked: 2,
  quotaExceeded: 3,
  invalidAction: 4,
} as const;

export function resolveIdlPath(): string {
  return process.env[IDL_PATH_ENV] ?? join(MODULE_DIR, "idl", "gatekeeper.json");
}

export function loadIdl(): anchor.Idl {
  const idlPath = resolveIdlPath();
  return JSON.parse(readFileSync(idlPath, "utf8")) as anchor.Idl;
}

export function getProgram(provider: anchor.AnchorProvider): any {
  return new anchor.Program(loadIdl() as any, provider);
}

export function deriveGatewayPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("gateway")], PROGRAM_ID)[0];
}

export function deriveOrganizationPda(gateway: PublicKey, name: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("organization"), gateway.toBuffer(), Buffer.from(name)],
    PROGRAM_ID,
  )[0];
}

export function deriveRolePda(organization: PublicKey, name: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("role"), organization.toBuffer(), Buffer.from(name)],
    PROGRAM_ID,
  )[0];
}

export function deriveKeyId(material: string): PublicKey {
  return new PublicKey(createHash("sha256").update(material).digest());
}

export function deriveApiKeyPda(organization: PublicKey, keyId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("api_key"), organization.toBuffer(), keyId.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function deriveQuotaPolicyPda(apiKey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("quota_policy"), apiKey.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function deriveQuotaRuntimePda(apiKey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("quota_runtime"), apiKey.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function deriveAuditCheckpointPda(apiKey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("audit_checkpoint"), apiKey.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function actionFromLabel(label: string): number {
  const normalized = label.trim().toLowerCase();
  switch (normalized) {
    case "metrics:read":
      return ACTIONS.metricsRead;
    case "metrics:write":
      return ACTIONS.metricsWrite;
    case "users:read":
      return ACTIONS.usersRead;
    case "users:write":
      return ACTIONS.usersWrite;
    case "admin":
      return ACTIONS.admin;
    default:
      throw new Error(`Unknown action: ${label}`);
  }
}

export function reasonLabel(reason: number): string {
  switch (reason) {
    case DECISION_REASONS.allowed:
      return "allowed";
    case DECISION_REASONS.unauthorized:
      return "unauthorized";
    case DECISION_REASONS.keyRevoked:
      return "key_revoked";
    case DECISION_REASONS.quotaExceeded:
      return "quota_exceeded";
    case DECISION_REASONS.invalidAction:
      return "invalid_action";
    default:
      return `unknown(${reason})`;
  }
}

export function maskFromPolicyInput(input: string): number {
  if (/^\d+$/.test(input.trim())) {
    return Number(input);
  }

  return input
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .reduce((mask, value) => {
      switch (value) {
        case "metrics:read":
          return mask | PERMISSIONS.metricsRead;
        case "metrics:write":
          return mask | PERMISSIONS.metricsWrite;
        case "users:read":
          return mask | PERMISSIONS.usersRead;
        case "users:write":
          return mask | PERMISSIONS.usersWrite;
        case "admin":
          return mask | PERMISSIONS.admin;
        default:
          throw new Error(`Unknown permission: ${value}`);
      }
    }, 0);
}

export function readWallet(path: string): anchor.Wallet {
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
  return new anchor.Wallet(anchor.web3.Keypair.fromSecretKey(secretKey));
}

export function resolveWalletPath(path?: string): string {
  if (path) {
    return path;
  }

  const localWalletPath = join(process.cwd(), "wallets", "localnet-authority.json");
  if (existsSync(localWalletPath)) {
    return localWalletPath;
  }

  throw new Error(
    "Wallet path not configured. Set --wallet or ANCHOR_WALLET to a funded keypair JSON file.",
  );
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }

  throw new Error(`Unable to convert value to number: ${String(value)}`);
}

export async function sendThroughMagicRouter(
  connection: anchor.web3.Connection,
  transaction: Transaction,
  wallet: anchor.Wallet,
): Promise<string> {
  const payer = (wallet as any).payer as anchor.web3.Keypair | undefined;
  if (!payer) {
    throw new Error("Magic Router flow requires a local keypair-backed wallet");
  }

  transaction.feePayer = wallet.publicKey;
  return sendMagicTransaction(connection, transaction, [payer]);
}

export function summarizeRuntimeHealth(runtimeAccount: any, checkpointAccount: any): RuntimeHealth {
  const rollingSequence = toNumber(runtimeAccount.rollingSequence);
  const settledSequence = toNumber(checkpointAccount.settledSequence);
  const drift = Math.max(rollingSequence - settledSequence, 0);
  const delegated = Boolean(runtimeAccount.isDelegated);
  const rollingAuditEntries = Array.isArray(runtimeAccount.rollingAudit)
    ? runtimeAccount.rollingAudit.length
    : 0;
  const notes: string[] = [];
  let recommendedAction: RuntimeHealth["recommendedAction"] = "none";

  if (delegated) {
    notes.push("Runtime is currently delegated to MagicBlock.");
    recommendedAction = drift > 0 ? "undelegate_and_settle" : "commit";
  } else if (drift > 0) {
    notes.push("Runtime has committed-but-unsettled changes on base.");
    recommendedAction = "settle";
  } else {
    notes.push("Runtime and checkpoint are aligned.");
  }

  if (rollingAuditEntries >= 8) {
    notes.push("Rolling audit buffer is full; older runtime-only entries have been evicted.");
  }

  return {
    delegated,
    rollingSequence,
    settledSequence,
    drift,
    rollingAuditEntries,
    currentWindowUsed: toNumber(runtimeAccount.currentWindowUsed),
    totalAllowed: toNumber(runtimeAccount.totalAllowed),
    totalRejected: toNumber(runtimeAccount.totalRejected),
    recommendedAction,
    notes,
  };
}
