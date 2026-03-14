use anchor_lang::prelude::*;

use crate::{
    constants::SEED_ROLE,
    errors::GatekeeperError,
    events::PolicyAttached,
    state::{Organization, Role},
    utils::validate_policy_mask,
};

#[derive(Accounts)]
pub struct AttachPolicyToRole<'info> {
    #[account(has_one = authority @ GatekeeperError::InvalidOrganizationAuthority)]
    pub organization: Account<'info, Organization>,
    #[account(
        mut,
        seeds = [SEED_ROLE, organization.key().as_ref(), role.name.as_bytes()],
        bump = role.bump,
        constraint = role.organization == organization.key() @ GatekeeperError::RoleOrganizationMismatch
    )]
    pub role: Account<'info, Role>,
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<AttachPolicyToRole>, policy_mask: u64) -> Result<()> {
    validate_policy_mask(policy_mask)?;

    ctx.accounts.role.policy_mask = policy_mask;

    emit!(PolicyAttached {
        organization: ctx.accounts.organization.key(),
        role: ctx.accounts.role.key(),
        policy_mask,
    });

    Ok(())
}

