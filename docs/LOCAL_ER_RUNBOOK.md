# Local ER Runbook

This runbook is for validating the full Gatekeeper split:

- base Solana control plane
- MagicBlock ER execution plane
- Magic Router-compatible transport for delegated writes

## Goal

A healthy local setup should pass these checks in order:

1. Base RPC responds to `getHealth`
2. ER RPC responds to `getIdentity`
3. Router endpoint supports:
   - `getBlockhashForAccounts`
   - `getDelegationStatus`
4. A plain JavaScript system transfer lands on base RPC
5. Gatekeeper delegated flow can run:
   - delegate
   - consume on ER
   - commit
   - undelegate
   - settle

## Quick commands

Router capability:

```bash
npm run diag:router -- --magic-router http://127.0.0.1:7799
```

Transport doctor:

```bash
npm run diag:transport -- --cluster http://127.0.0.1:8899 --magic-router http://127.0.0.1:7799 --wallet wallets/localnet-authority.json
```

## Expected outcomes

### Base RPC is healthy

`diag:transport` should report:

- `baseRpc.health.ok = true`
- `baseRpc.latestBlockhash.ok = true`

### Router-compatible endpoint is present

`diag:router -- --strict true` should succeed only if all three methods are available:

- `getIdentity`
- `getBlockhashForAccounts`
- `getDelegationStatus`

If `getIdentity` works but `getBlockhashForAccounts` fails, you have an ER validator but not a router-compatible endpoint.

### JavaScript transport is healthy

`diag:transport` should report:

- `jsTransfer.ok = true`
- a non-zero `observedBalanceLamports`

If the JS transfer fails while `solana transfer` succeeds, the local RPC itself is alive and the problem is in the JS transport path or local environment.

## Windows note

In the current environment we observed:

- the MagicBlock ER validator can run on Windows
- the installed `rpc-router` package is only a shim
- the expected router-only RPC methods may still be missing from the endpoint you point the CLI at

That means native Windows may be enough to launch an ER validator, but not enough to validate the full Magic Router path.

## Recommended local path

For the cleanest end-to-end validation:

1. Run base Solana validator locally
2. Run MagicBlock ER validator locally
3. Run a router-capable endpoint that passes `diag:router -- --strict true`
4. Run `diag:transport`
5. Run the delegated Gatekeeper flow

If native Windows cannot provide step 3, use WSL2 or a Linux host for the router component.

## When to trust the environment

Do not trust a local ER demo until all of these are true:

- router probe passes
- JS transfer probe passes
- delegated Gatekeeper flow lands and mutates state

Without those, you can validate architecture and local validator startup, but not the full request path.
