use anchor_lang::prelude::*;

use crate::{
    constants::{DEFAULT_VALIDATOR, SEED_AUDIT_CHECKPOINT, SEED_QUOTA_RUNTIME},
    errors::GatekeeperError,
    events::QuotaRuntimeInitialized,
    state::{ApiKey, AuditCheckpoint, Organization, QuotaPolicy, QuotaRuntime},
    utils::current_timestamp,
};

#[derive(Accounts)]
pub struct InitializeQuotaRuntime<'info> {
    #[account(has_one = authority @ GatekeeperError::InvalidOrganizationAuthority)]
    pub organization: Account<'info, Organization>,
    #[account(
        constraint = api_key.organization == organization.key() @ GatekeeperError::ApiKeyOrganizationMismatch
    )]
    pub api_key: Account<'info, ApiKey>,
    #[account(
        constraint = quota_policy.organization == organization.key() @ GatekeeperError::QuotaPolicyMismatch,
        constraint = quota_policy.api_key == api_key.key() @ GatekeeperError::QuotaPolicyMismatch
    )]
    pub quota_policy: Account<'info, QuotaPolicy>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + QuotaRuntime::INIT_SPACE,
        seeds = [SEED_QUOTA_RUNTIME, api_key.key().as_ref()],
        bump
    )]
    pub quota_runtime: Account<'info, QuotaRuntime>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + AuditCheckpoint::INIT_SPACE,
        seeds = [SEED_AUDIT_CHECKPOINT, api_key.key().as_ref()],
        bump
    )]
    pub audit_checkpoint: Account<'info, AuditCheckpoint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeQuotaRuntime>) -> Result<()> {
    require!(
        !ctx.accounts.quota_runtime.initialized,
        GatekeeperError::RuntimeAlreadyInitialized
    );

    let now = current_timestamp()?;
    let quota_runtime = &mut ctx.accounts.quota_runtime;
    quota_runtime.initialized = true;
    quota_runtime.bump = ctx.bumps.quota_runtime;
    quota_runtime.organization = ctx.accounts.organization.key();
    quota_runtime.api_key = ctx.accounts.api_key.key();
    quota_runtime.quota_policy = ctx.accounts.quota_policy.key();
    quota_runtime.delegated_validator = DEFAULT_VALIDATOR.into();
    quota_runtime.commit_frequency_ms = 0;
    quota_runtime.is_delegated = false;
    quota_runtime.total_allowed = 0;
    quota_runtime.total_rejected = 0;
    quota_runtime.current_window_used = 0;
    quota_runtime.current_window_started_at = now;
    quota_runtime.rolling_sequence = 0;
    quota_runtime.last_action = 0;
    quota_runtime.last_reason = 0;
    quota_runtime.last_request_at = 0;
    quota_runtime.last_settled_sequence = 0;
    quota_runtime.last_settled_at = 0;
    quota_runtime.rolling_audit = Vec::new();

    let audit_checkpoint = &mut ctx.accounts.audit_checkpoint;
    if !audit_checkpoint.initialized {
        audit_checkpoint.initialized = true;
        audit_checkpoint.bump = ctx.bumps.audit_checkpoint;
        audit_checkpoint.organization = ctx.accounts.organization.key();
        audit_checkpoint.api_key = ctx.accounts.api_key.key();
        audit_checkpoint.quota_policy = ctx.accounts.quota_policy.key();
        audit_checkpoint.settled_sequence = 0;
        audit_checkpoint.total_allowed = 0;
        audit_checkpoint.total_rejected = 0;
        audit_checkpoint.current_window_used = 0;
        audit_checkpoint.current_window_started_at = now;
        audit_checkpoint.last_action = 0;
        audit_checkpoint.last_reason = 0;
        audit_checkpoint.last_request_at = 0;
        audit_checkpoint.last_settled_at = 0;
    }

    emit!(QuotaRuntimeInitialized {
        organization: ctx.accounts.organization.key(),
        api_key: ctx.accounts.api_key.key(),
        quota_runtime: quota_runtime.key(),
        audit_checkpoint: audit_checkpoint.key(),
    });

    Ok(())
}

