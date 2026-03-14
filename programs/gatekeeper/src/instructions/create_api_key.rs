use anchor_lang::prelude::*;

use crate::{
    constants::SEED_API_KEY,
    errors::GatekeeperError,
    events::ApiKeyCreated,
    state::{ApiKey, Organization, Role},
    utils::{current_timestamp, validate_label},
};

#[derive(Accounts)]
#[instruction(key_id: Pubkey, _label: String)]
pub struct CreateApiKey<'info> {
    #[account(mut, has_one = authority @ GatekeeperError::InvalidOrganizationAuthority)]
    pub organization: Account<'info, Organization>,
    #[account(
        constraint = role.organization == organization.key() @ GatekeeperError::RoleOrganizationMismatch
    )]
    pub role: Account<'info, Role>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + ApiKey::INIT_SPACE,
        seeds = [SEED_API_KEY, organization.key().as_ref(), key_id.as_ref()],
        bump
    )]
    pub api_key: Account<'info, ApiKey>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateApiKey>, key_id: Pubkey, label: String) -> Result<()> {
    validate_label(&label)?;

    let api_key = &mut ctx.accounts.api_key;
    require!(!api_key.initialized, GatekeeperError::DuplicateKey);

    let now = current_timestamp()?;

    api_key.initialized = true;
    api_key.bump = ctx.bumps.api_key;
    api_key.organization = ctx.accounts.organization.key();
    api_key.role = ctx.accounts.role.key();
    api_key.key_id = key_id;
    api_key.label = label.clone();
    api_key.active = true;
    api_key.created_by = ctx.accounts.authority.key();
    api_key.created_at = now;
    api_key.revoked_at = 0;

    ctx.accounts.organization.api_key_count = ctx
        .accounts
        .organization
        .api_key_count
        .checked_add(1)
        .ok_or(GatekeeperError::MathOverflow)?;

    emit!(ApiKeyCreated {
        organization: ctx.accounts.organization.key(),
        api_key: api_key.key(),
        role: ctx.accounts.role.key(),
        key_id,
        label,
    });

    Ok(())
}

