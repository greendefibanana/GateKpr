#![allow(unexpected_cfgs)]
#![allow(ambiguous_glob_reexports)]

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("5UetKs63bZxoYy5dZvJxYjUSTBmaF5tN7ADR8pB6SMZu");

#[ephemeral]
#[program]
pub mod gatekeeper {
    use super::*;

    pub fn initialize_gateway(ctx: Context<InitializeGateway>) -> Result<()> {
        instructions::initialize_gateway::handler(ctx)
    }

    pub fn create_organization(
        ctx: Context<CreateOrganization>,
        name: String,
        organization_authority: Pubkey,
    ) -> Result<()> {
        instructions::create_organization::handler(ctx, name, organization_authority)
    }

    pub fn create_role(ctx: Context<CreateRole>, name: String) -> Result<()> {
        instructions::create_role::handler(ctx, name)
    }

    pub fn attach_policy_to_role(
        ctx: Context<AttachPolicyToRole>,
        policy_mask: u64,
    ) -> Result<()> {
        instructions::attach_policy_to_role::handler(ctx, policy_mask)
    }

    pub fn create_api_key(
        ctx: Context<CreateApiKey>,
        key_id: Pubkey,
        label: String,
    ) -> Result<()> {
        instructions::create_api_key::handler(ctx, key_id, label)
    }

    pub fn create_quota_policy(
        ctx: Context<CreateQuotaPolicy>,
        max_requests: u64,
        window_seconds: i64,
    ) -> Result<()> {
        instructions::create_quota_policy::handler(ctx, max_requests, window_seconds)
    }

    pub fn initialize_quota_runtime(ctx: Context<InitializeQuotaRuntime>) -> Result<()> {
        instructions::initialize_quota_runtime::handler(ctx)
    }

    pub fn delegate_quota_runtime(
        ctx: Context<DelegateQuotaRuntime>,
        validator: Option<Pubkey>,
        commit_frequency_ms: u32,
    ) -> Result<()> {
        instructions::delegate_quota_runtime::handler(ctx, validator, commit_frequency_ms)
    }

    pub fn consume_request(ctx: Context<ConsumeRequest>, action: u8) -> Result<()> {
        instructions::consume_request::handler(ctx, action)
    }

    pub fn commit_quota_runtime(ctx: Context<CommitQuotaRuntime>) -> Result<()> {
        instructions::commit_quota_runtime::handler(ctx)
    }

    pub fn commit_and_undelegate_quota_runtime(
        ctx: Context<CommitAndUndelegateQuotaRuntime>,
    ) -> Result<()> {
        instructions::commit_and_undelegate_quota_runtime::handler(ctx)
    }

    pub fn settle_runtime_checkpoint(ctx: Context<SettleRuntimeCheckpoint>) -> Result<()> {
        instructions::settle_runtime_checkpoint::handler(ctx)
    }

    pub fn revoke_api_key(ctx: Context<RevokeApiKey>) -> Result<()> {
        instructions::revoke_api_key::handler(ctx)
    }
}
