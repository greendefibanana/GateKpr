use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};

use crate::{
    constants::SEED_QUOTA_RUNTIME,
    errors::GatekeeperError,
    events::QuotaRuntimeCommitted,
    state::{ApiKey, Organization, QuotaRuntime},
};

#[commit]
#[derive(Accounts)]
pub struct CommitQuotaRuntime<'info> {
    #[account(has_one = authority @ GatekeeperError::InvalidOrganizationAuthority)]
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
    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<CommitQuotaRuntime>) -> Result<()> {
    require!(
        ctx.accounts.quota_runtime.is_delegated,
        GatekeeperError::RuntimeNotDelegated
    );

    ctx.accounts.quota_runtime.exit(&crate::ID)?;
    let quota_runtime_info = ctx.accounts.quota_runtime.to_account_info();
    let committed_accounts = vec![&quota_runtime_info];
    commit_accounts(
        &ctx.accounts.authority.to_account_info(),
        committed_accounts,
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program.to_account_info(),
    )?;

    emit!(QuotaRuntimeCommitted {
        organization: ctx.accounts.organization.key(),
        api_key: ctx.accounts.api_key.key(),
        quota_runtime: ctx.accounts.quota_runtime.key(),
        sequence: ctx.accounts.quota_runtime.rolling_sequence,
        still_delegated: true,
    });

    Ok(())
}
