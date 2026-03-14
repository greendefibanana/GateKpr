import { Connection } from "@solana/web3.js";

export type JsonRpcProbe = {
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type RouterCapabilityReport = {
  endpoint: string;
  identity: JsonRpcProbe;
  blockhashForAccounts: JsonRpcProbe;
  delegationStatus: JsonRpcProbe;
};

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return response.json();
}

export async function probeJsonRpcMethod(
  endpoint: string,
  method: string,
  params: unknown[] = [],
): Promise<JsonRpcProbe> {
  try {
    const payload = await postJson(endpoint, {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    });

    if (payload.error) {
      return {
        ok: false,
        error: JSON.stringify(payload.error),
      };
    }

    return {
      ok: true,
      result: payload.result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeDelegationStatus(
  endpoint: string,
  account = "11111111111111111111111111111111",
): Promise<JsonRpcProbe> {
  try {
    const payload = await postJson(`${endpoint}/getDelegationStatus`, {
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [account],
    });

    if (payload.error) {
      return {
        ok: false,
        error: JSON.stringify(payload.error),
      };
    }

    return {
      ok: true,
      result: payload.result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeMagicRouterEndpoint(
  connectionOrEndpoint: Connection | string,
): Promise<RouterCapabilityReport> {
  const endpoint =
    typeof connectionOrEndpoint === "string"
      ? connectionOrEndpoint
      : connectionOrEndpoint.rpcEndpoint;

  return {
    endpoint,
    identity: await probeJsonRpcMethod(endpoint, "getIdentity"),
    blockhashForAccounts: await probeJsonRpcMethod(endpoint, "getBlockhashForAccounts", [[]]),
    delegationStatus: await probeDelegationStatus(endpoint),
  };
}
