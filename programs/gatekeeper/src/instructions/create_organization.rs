use anchor_lang::prelude::*;

use crate::{
    constants::SEED_ORGANIZATION,
    errors::GatekeeperError,
    events::OrganizationCreated,
    state::{Gateway, Organization},
    utils::validate_name,
};

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreateOrganization<'info> {
    #[account(mut, has_one = authority @ GatekeeperError::InvalidOrganizationAuthority)]
    pub gateway: Account<'info, Gateway>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Organization::INIT_SPACE,
        seeds = [SEED_ORGANIZATION, gateway.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub organization: Account<'info, Organization>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateOrganization>,
    name: String,
    organization_authority: Pubkey,
) -> Result<()> {
    validate_name(&name)?;

    let organization = &mut ctx.accounts.organization;
    require!(
        !organization.initialized,
        GatekeeperError::DuplicateOrganization
    );

    organization.initialized = true;
    organization.bump = ctx.bumps.organization;
    organization.gateway = ctx.accounts.gateway.key();
    organization.authority = organization_authority;
    organization.name = name.clone();
    organization.role_count = 0;
    organization.api_key_count = 0;
    organization.settlement_count = 0;

    ctx.accounts.gateway.organization_count = ctx
        .accounts
        .gateway
        .organization_count
        .checked_add(1)
        .ok_or(GatekeeperError::MathOverflow)?;

    emit!(OrganizationCreated {
        organization: organization.key(),
        authority: organization.authority,
        name,
    });

    Ok(())
}
