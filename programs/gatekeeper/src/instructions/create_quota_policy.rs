use anchor_lang::prelude::*;

use crate::{
    constants::SEED_QUOTA_POLICY,
    errors::GatekeeperError,
    events::QuotaPolicyConfigured,
    state::{ApiKey, Organization, QuotaPolicy},
};

#[derive(Accounts)]
pub struct CreateQuotaPolicy<'info> {
    #[account(has_one = authority @ GatekeeperError::InvalidOrganizationAuthority)]
    pub organization: Account<'info, Organization>,
    #[account(
        constraint = api_key.organization == organization.key() @ GatekeeperError::ApiKeyOrganizationMismatch
    )]
    pub api_key: Account<'info, ApiKey>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + QuotaPolicy::INIT_SPACE,
        seeds = [SEED_QUOTA_POLICY, api_key.key().as_ref()],
        bump
    )]
    pub quota_policy: Account<'info, QuotaPolicy>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateQuotaPolicy>,
    max_requests: u64,
    window_seconds: i64,
) -> Result<()> {
    require!(
        max_requests > 0 && window_seconds > 0,
        GatekeeperError::InvalidQuotaConfig
    );

    let quota_policy = &mut ctx.accounts.quota_policy;
    quota_policy.initialized = true;
    quota_policy.bump = ctx.bumps.quota_policy;
    quota_policy.organization = ctx.accounts.organization.key();
    quota_policy.api_key = ctx.accounts.api_key.key();
    quota_policy.max_requests = max_requests;
    quota_policy.window_seconds = window_seconds;

    emit!(QuotaPolicyConfigured {
        organization: ctx.accounts.organization.key(),
        api_key: ctx.accounts.api_key.key(),
        quota_policy: quota_policy.key(),
        max_requests,
        window_seconds,
    });

    Ok(())
}

