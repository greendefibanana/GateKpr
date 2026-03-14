use anchor_lang::prelude::*;

use crate::{
    constants::{SEED_AUDIT_CHECKPOINT, SEED_QUOTA_RUNTIME},
    errors::GatekeeperError,
    events::AuditCheckpointSettled,
    state::{ApiKey, AuditCheckpoint, Organization, QuotaRuntime},
    utils::current_timestamp,
};

#[derive(Accounts)]
pub struct SettleRuntimeCheckpoint<'info> {
    #[account(mut, has_one = authority @ GatekeeperError::InvalidOrganizationAuthority)]
    pub organization: Account<'info, Organization>,
    #[account(
        constraint = api_key.organization == organization.key() @ GatekeeperError::ApiKeyOrganizationMismatch
    )]
    pub api_key: Account<'info, ApiKey>,
    #[account(
        mut,
        seeds = [SEED_QUOTA_RUNTIME, api_key.key().as_ref()],
        bump = quota_runtime.bump,
        constraint = quota_runtime.organization == organization.key() @ GatekeeperError::QuotaRuntimeMismatch,
        constraint = quota_runtime.api_key == api_key.key() @ GatekeeperError::QuotaRuntimeMismatch
    )]
    pub quota_runtime: Account<'info, QuotaRuntime>,
    #[account(
        mut,
        seeds = [SEED_AUDIT_CHECKPOINT, api_key.key().as_ref()],
        bump = audit_checkpoint.bump,
        constraint = audit_checkpoint.organization == organization.key() @ GatekeeperError::AuditCheckpointMismatch,
        constraint = audit_checkpoint.api_key == api_key.key() @ GatekeeperError::AuditCheckpointMismatch,
        constraint = audit_checkpoint.quota_policy == quota_runtime.quota_policy @ GatekeeperError::AuditCheckpointMismatch
    )]
    pub audit_checkpoint: Account<'info, AuditCheckpoint>,
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<SettleRuntimeCheckpoint>) -> Result<()> {
    require!(
        !ctx.accounts.quota_runtime.is_delegated,
        GatekeeperError::RuntimeStillDelegated
    );

    let now = current_timestamp()?;
    let quota_runtime = &mut ctx.accounts.quota_runtime;
    let audit_checkpoint = &mut ctx.accounts.audit_checkpoint;

    audit_checkpoint.settled_sequence = quota_runtime.rolling_sequence;
    audit_checkpoint.total_allowed = quota_runtime.total_allowed;
    audit_checkpoint.total_rejected = quota_runtime.total_rejected;
    audit_checkpoint.current_window_used = quota_runtime.current_window_used;
    audit_checkpoint.current_window_started_at = quota_runtime.current_window_started_at;
    audit_checkpoint.last_action = quota_runtime.last_action;
    audit_checkpoint.last_reason = quota_runtime.last_reason;
    audit_checkpoint.last_request_at = quota_runtime.last_request_at;
    audit_checkpoint.last_settled_at = now;

    quota_runtime.last_settled_sequence = quota_runtime.rolling_sequence;
    quota_runtime.last_settled_at = now;
    quota_runtime.rolling_audit.clear();

    ctx.accounts.organization.settlement_count = ctx
        .accounts
        .organization
        .settlement_count
        .checked_add(1)
        .ok_or(GatekeeperError::MathOverflow)?;

    emit!(AuditCheckpointSettled {
        organization: ctx.accounts.organization.key(),
        api_key: ctx.accounts.api_key.key(),
        quota_runtime: quota_runtime.key(),
        audit_checkpoint: audit_checkpoint.key(),
        settled_sequence: audit_checkpoint.settled_sequence,
        settled_at: now,
    });

    Ok(())
}
