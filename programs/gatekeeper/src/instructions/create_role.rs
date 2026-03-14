use anchor_lang::prelude::*;

use crate::{
    constants::SEED_ROLE,
    errors::GatekeeperError,
    events::RoleCreated,
    state::{Organization, Role},
    utils::{current_timestamp, validate_name},
};

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreateRole<'info> {
    #[account(mut, has_one = authority @ GatekeeperError::InvalidOrganizationAuthority)]
    pub organization: Account<'info, Organization>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Role::INIT_SPACE,
        seeds = [SEED_ROLE, organization.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub role: Account<'info, Role>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateRole>, name: String) -> Result<()> {
    validate_name(&name)?;

    let role = &mut ctx.accounts.role;
    require!(!role.initialized, GatekeeperError::DuplicateRole);

    role.initialized = true;
    role.bump = ctx.bumps.role;
    role.organization = ctx.accounts.organization.key();
    role.name = name.clone();
    role.policy_mask = 0;
    role.created_at = current_timestamp()?;

    ctx.accounts.organization.role_count = ctx
        .accounts
        .organization
        .role_count
        .checked_add(1)
        .ok_or(GatekeeperError::MathOverflow)?;

    emit!(RoleCreated {
        organization: ctx.accounts.organization.key(),
        role: role.key(),
        name,
    });

    Ok(())
}

