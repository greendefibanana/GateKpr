import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { readWallet } from "../client/gatekeeper";
import { createContext, parseArgs } from "./common";
import { probeJsonRpcMethod, probeMagicRouterEndpoint } from "./router-diagnostics";

type JsTransferProbe = {
  ok: boolean;
  signature?: string;
  recipient?: string;
  observedBalanceLamports: number;
  status?: unknown;
  error?: string;
};

async function probeJsTransfer(
  context: ReturnType<typeof createContext>,
  lamports: number,
): Promise<JsTransferProbe> {
  const payer = (context.wallet as any).payer as Keypair | undefined;
  if (!payer) {
    return {
      ok: false,
      observedBalanceLamports: 0,
      error: "Wallet is not backed by a local keypair.",
    };
  }

  const recipient = Keypair.generate().publicKey;
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: context.wallet.publicKey,
      toPubkey: recipient,
      lamports,
    }),
  );

  let signature: string | undefined;

  try {
    const latest = await context.baseProvider.connection.getLatestBlockhash("confirmed");
    transaction.feePayer = context.wallet.publicKey;
    transaction.recentBlockhash = latest.blockhash;
    transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
    transaction.sign(payer);

    signature = await context.baseProvider.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 5,
    });
  } catch (error) {
    return {
      ok: false,
      observedBalanceLamports: 0,
      recipient: recipient.toBase58(),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const balance = await context.baseProvider.connection.getBalance(recipient, "confirmed");
    if (balance >= lamports) {
      const status = await context.baseProvider.connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });

      return {
        ok: true,
        signature,
        recipient: recipient.toBase58(),
        observedBalanceLamports: balance,
        status: status.value[0],
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  const status = await context.baseProvider.connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });

  return {
    ok: false,
    signature,
    recipient: recipient.toBase58(),
    observedBalanceLamports: await context.baseProvider.connection.getBalance(recipient, "confirmed"),
    status: status.value[0],
    error: "JS transfer did not materialize on-chain within 30 seconds.",
  };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const context = createContext(flags);
  const lamports = Number(flags.lamports ?? 1_000);
  const walletPath = flags.wallet ?? process.env.ANCHOR_WALLET;
  if (walletPath) {
    readWallet(walletPath);
  }

  const baseHealth = await probeJsonRpcMethod(context.baseProvider.connection.rpcEndpoint, "getHealth");
  const baseBlockhash = await probeJsonRpcMethod(
    context.baseProvider.connection.rpcEndpoint,
    "getLatestBlockhash",
    [{ commitment: "confirmed" }],
  );

  const report: Record<string, unknown> = {
    baseRpc: {
      endpoint: context.baseProvider.connection.rpcEndpoint,
      health: baseHealth,
      latestBlockhash: baseBlockhash,
    },
  };

  if (context.routerConnection) {
    report.routerRpc = await probeMagicRouterEndpoint(context.routerConnection);
  }

  report.jsTransfer = await probeJsTransfer(context, lamports);
  console.log(JSON.stringify(report, null, 2));

  const jsTransfer = report.jsTransfer as JsTransferProbe;
  if (!baseHealth.ok) {
    throw new Error("Base RPC health probe failed.");
  }

  if (!jsTransfer.ok) {
    throw new Error(jsTransfer.error ?? "JS transfer probe failed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
