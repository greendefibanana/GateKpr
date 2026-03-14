use anchor_lang::prelude::*;

use crate::{
    constants::SEED_API_KEY,
    errors::GatekeeperError,
    events::ApiKeyRevoked,
    state::{ApiKey, Organization},
    utils::current_timestamp,
};

#[derive(Accounts)]
pub struct RevokeApiKey<'info> {
    #[account(has_one = authority @ GatekeeperError::InvalidOrganizationAuthority)]
    pub organization: Account<'info, Organization>,
    #[account(
        mut,
        seeds = [SEED_API_KEY, organization.key().as_ref(), api_key.key_id.as_ref()],
        bump = api_key.bump,
        constraint = api_key.organization == organization.key() @ GatekeeperError::ApiKeyOrganizationMismatch
    )]
    pub api_key: Account<'info, ApiKey>,
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<RevokeApiKey>) -> Result<()> {
    let api_key = &mut ctx.accounts.api_key;
    require!(api_key.active, GatekeeperError::KeyRevoked);

    let revoked_at = current_timestamp()?;
    api_key.active = false;
    api_key.revoked_at = revoked_at;

    emit!(ApiKeyRevoked {
        organization: ctx.accounts.organization.key(),
        api_key: api_key.key(),
        revoked_at,
    });

    Ok(())
}

