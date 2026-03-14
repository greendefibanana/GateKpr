use anchor_lang::prelude::*;

use crate::{constants::SEED_GATEWAY, events::GatewayInitialized, state::Gateway};

#[derive(Accounts)]
pub struct InitializeGateway<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Gateway::INIT_SPACE,
        seeds = [SEED_GATEWAY],
        bump
    )]
    pub gateway: Account<'info, Gateway>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeGateway>) -> Result<()> {
    let gateway = &mut ctx.accounts.gateway;
    gateway.bump = ctx.bumps.gateway;
    gateway.authority = ctx.accounts.authority.key();
    gateway.organization_count = 0;

    emit!(GatewayInitialized {
        gateway: gateway.key(),
        authority: gateway.authority,
    });

    Ok(())
}

