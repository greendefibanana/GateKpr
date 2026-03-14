# Devnet Web2 Application Test Log

## Run Metadata

- Date: March 14, 2026
- Run ID: `20260314130138`
- Cluster: `https://api.devnet.solana.com`
- Program ID: `5UetKs63bZxoYy5dZvJxYjUSTBmaF5tN7ADR8pB6SMZu`
- Wallet: `9BeBqNy15zt5mq112RrR35GaHNoqkPNFe1brhtEocdpU`
- Final payer balance after run: `2.542129391 SOL`

## Test Subjects

- Shared gateway: `7t4rD81ypiDENCYzNy7suePf6qHovsFFRzeSsJ5g3zRY`
- Acme tenant: `7Ci4DDcMHx86fhVCLgpWpuAyFyuGRXeTSCibaTtrqDs7`
- Globex tenant: `DYPSqXGvNcz419f8fGoiFaTD9EnnST7u5qhRnvYqjfvE`
- Acme API key PDA: `7kyi1AjD1DdM68RdNtakgqfL3sns9Y3jrcjENFjwxkdz`
- Globex API key PDA: `9Jt5G4yA6syqjiG5uNpm4Qtxy3z4KxqSGqHzKpfKqKvB`
- Acme runtime PDA: `Bimfq3hp4NrFWxX8gE5akurXVV1yvvonPcUNLbgavPQ4`
- Globex runtime PDA: `EjYpQYsY1PUJufLC4WtJfxBpvgtqjWorcrYPDWi93a21`
- Acme checkpoint PDA: `GRZHPJTNUbvjBTt6rXo4nvwLas75wjfjz7zYEpnWHY5u`

## Application Results

### 1. Shared Control Plane Bootstrap

- Status: `passed`
- Result:
  - shared gateway already existed on devnet and was reused safely
  - `created=false`

### 2. Multi-tenant SaaS Onboarding

- Status: `passed`
- Signature: `3J7HCNNm9NeoHSS9Zn2oZfHA8fLy5mQ9fRg28KJeGF13z3x35Ppg1QkFPf82YxKqymBUqQAhRVyNGxgpaTqaDvi`
- Result:
  - distinct `Organization` PDAs created for Acme and Globex
  - distinct `Role`, `ApiKey`, `QuotaPolicy`, `QuotaRuntime`, and `AuditCheckpoint` accounts created per tenant

### 3. API Gateway RBAC Enforcement

- Status: `passed`
- Allowed signature: `5MoB1k7F3r48ZfSAhLtoQkQhP5fmCQuQgzpkSF7n1GMQpDuLAkFHdiAo4cHpVfJo4To5Tr3GGYtH4UDc5TDMVpHd`
- Rejected signature: `4GbHueHxxbvjSUhw2E1M5P7S6Y8FVxc4R5TxBS6cjEuQLsadbLZNhyuNHQFwpAQFmChYrqhPAV1s2XMBnKRvnGGi`
- Result:
  - Acme `metrics:read` request was allowed
  - Acme `users:write` request was rejected as unauthorized

### 4. Per-key Rate Limiting

- Status: `passed`
- Within quota signature: `4eD61kjvDr2KvciC1uR2x6rxjPBfhqh7YKkMGBesPbnbXU1xTjhM8Su3wEaYr95Vz8VSgGgsy1hNDhWSXqWxhVZ4`
- Over quota signature: `193LyGPZjGsZXjBWxt9UTXQCktFDG3HAgPjZUEgTZqbBcLc1u94S7x23fvZETdJsxxk5ezMwCginbh1nR5WmGUc`
- Result:
  - Acme quota limit was `2`
  - third permitted request was rejected as `quota_exceeded`

### 5. Tenant Isolation

- Status: `passed`
- Signature: `5LEnpvpoBox1zWTHZHgfRaWE252QzNi9NwjRAAyuGrPzhGE32ky6UmMLEd4v4M3gugULA2jfFQ5kpstJ3175WAhq`
- Result:
  - Globex `users:write` request succeeded
  - Globex runtime remained unaffected by Acme quota exhaustion and rejection history

### 6. Audit Checkpointing

- Status: `passed`
- Initial settlement signature: `oDAeJbXxDxgYmBWrsysybFqa1zPdMKbexTAe64hgtD9YeAXDzrPjtB5RMMFutqFvaQw5KaoChAQAbuEW6fscgir`
- Result:
  - Acme runtime rolling audit buffer was compacted into durable checkpoint state
  - checkpoint totals settled to `2 allowed / 2 rejected`

### 7. Credential Revocation

- Status: `passed`
- Revoke signature: `48UUPj6FmRHzBEDG2ins7qm3V3KncDVK11XQaHRnJJzREbnhTsR1Q8AmKo2SE65Hrk6sFueoxrK9mofKWwHxvXPP`
- Rejected post-revoke signature: `2joVqPYHvtBmkDK7c18jM8YESAiT9baisVWRwEGtcZ79xE5UPFSDuYYNqUfvg8yMKLF6kUwUeRR8oByNjJRwwYGv`
- Final settle signature: `VGzyvrnkZgEPPG7H3DkLvXtNXw2dh4xu2vQUMpyzPS8AJnyiDscHCzH8W9MUSZM87Zgfppnf8Ws8GN7tEvPyt4m`
- Result:
  - Acme API key was revoked
  - next Acme request was rejected with `key_revoked`
  - rejection was then durably settled into checkpoint state

## Final Settled State

### Acme

- `active=false`
- `delegated=false`
- `rolling_sequence=5`
- `settled_sequence=5`
- `drift=0`
- `rolling_audit_entries=0`
- `total_allowed=2`
- `total_rejected=3`
- `current_window_used=2`

### Globex

- `total_allowed=1`
- `total_rejected=0`
- `rolling_sequence=1`

## Conclusion

This devnet run verified multiple practical Web2 application patterns against the deployed Gatekeeper program:

- multi-tenant SaaS backend onboarding
- API gateway RBAC enforcement
- per-key rate limiting
- tenant-isolated runtime state
- durable audit checkpointing
- credential revocation

All application scenarios passed on devnet, and the Acme runtime ended in a fully settled state with `drift=0`.
