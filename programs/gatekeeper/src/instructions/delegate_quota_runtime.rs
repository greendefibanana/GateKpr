use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::{
    constants::{DEFAULT_VALIDATOR, SEED_QUOTA_RUNTIME},
    errors::GatekeeperError,
    events::QuotaRuntimeDelegated,
    state::{ApiKey, Organization, QuotaPolicy, QuotaRuntime},
};

#[delegate]
#[derive(Accounts)]
pub struct DelegateQuotaRuntime<'info> {
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
        mut,
        seeds = [SEED_QUOTA_RUNTIME, api_key.key().as_ref()],
        bump = quota_runtime.bump,
        constraint = quota_runtime.organization == organization.key() @ GatekeeperError::QuotaRuntimeMismatch,
        constraint = quota_runtime.api_key == api_key.key() @ GatekeeperError::QuotaRuntimeMismatch,
        constraint = quota_runtime.quota_policy == quota_policy.key() @ GatekeeperError::QuotaPolicyMismatch,
        del
    )]
    pub quota_runtime: Account<'info, QuotaRuntime>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<DelegateQuotaRuntime>,
    validator: Option<Pubkey>,
    commit_frequency_ms: u32,
) -> Result<()> {
    require!(
        !ctx.accounts.quota_runtime.is_delegated,
        GatekeeperError::RuntimeAlreadyDelegated
    );
    require!(
        commit_frequency_ms > 0,
        GatekeeperError::InvalidCommitFrequency
    );

    let default_validator: Pubkey = DEFAULT_VALIDATOR.into();
    let validator_pubkey = validator.unwrap_or(default_validator);
    let quota_runtime = &mut ctx.accounts.quota_runtime;
    quota_runtime.is_delegated = true;
    quota_runtime.delegated_validator = validator_pubkey;
    quota_runtime.commit_frequency_ms = commit_frequency_ms;
    quota_runtime.exit(&crate::ID)?;

    ctx.accounts.delegate_quota_runtime(
        &ctx.accounts.authority,
        &[SEED_QUOTA_RUNTIME, ctx.accounts.api_key.key().as_ref()],
        DelegateConfig {
            validator: validator.filter(|key| *key != default_validator),
            commit_frequency_ms,
        },
    )?;

    emit!(QuotaRuntimeDelegated {
        organization: ctx.accounts.organization.key(),
        api_key: ctx.accounts.api_key.key(),
        quota_runtime: ctx.accounts.quota_runtime.key(),
        commit_frequency_ms,
        validator: validator_pubkey,
    });

    Ok(())
}

