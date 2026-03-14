use anchor_lang::prelude::*;

use crate::{
    errors::GatekeeperError,
    events::RequestConsumed,
    state::{ApiKey, Organization, QuotaPolicy, QuotaRuntime, Role},
    utils::{
        append_runtime_audit, current_timestamp, reset_runtime_if_expired, role_allows, Action,
        DecisionReason,
    },
};

#[derive(Accounts)]
pub struct ConsumeRequest<'info> {
    pub payer: Signer<'info>,
    pub organization: Account<'info, Organization>,
    #[account(
        constraint = role.organization == organization.key() @ GatekeeperError::RoleOrganizationMismatch
    )]
    pub role: Account<'info, Role>,
    #[account(
        constraint = api_key.organization == organization.key() @ GatekeeperError::ApiKeyOrganizationMismatch,
        constraint = api_key.role == role.key() @ GatekeeperError::ApiKeyRoleMismatch
    )]
    pub api_key: Account<'info, ApiKey>,
    #[account(
        constraint = quota_policy.organization == organization.key() @ GatekeeperError::QuotaPolicyMismatch,
        constraint = quota_policy.api_key == api_key.key() @ GatekeeperError::QuotaPolicyMismatch
    )]
    pub quota_policy: Account<'info, QuotaPolicy>,
    #[account(
        mut,
        constraint = quota_runtime.organization == organization.key() @ GatekeeperError::QuotaRuntimeMismatch,
        constraint = quota_runtime.api_key == api_key.key() @ GatekeeperError::QuotaRuntimeMismatch,
        constraint = quota_runtime.quota_policy == quota_policy.key() @ GatekeeperError::QuotaPolicyMismatch
    )]
    pub quota_runtime: Account<'info, QuotaRuntime>,
}

pub fn handler(ctx: Context<ConsumeRequest>, action: u8) -> Result<()> {
    let now = current_timestamp()?;
    let action_result = Action::try_from(action);
    let mut allowed = false;
    let mut reason = DecisionReason::InvalidAction;

    if !ctx.accounts.api_key.active {
        reason = DecisionReason::KeyRevoked;
    } else if let Ok(parsed_action) = action_result {
        if !role_allows(&ctx.accounts.role, parsed_action) {
            reason = DecisionReason::Unauthorized;
        } else {
            reset_runtime_if_expired(
                &mut ctx.accounts.quota_runtime,
                &ctx.accounts.quota_policy,
                now,
            )?;

            if ctx.accounts.quota_runtime.current_window_used
                >= ctx.accounts.quota_policy.max_requests
            {
                reason = DecisionReason::QuotaExceeded;
            } else {
                ctx.accounts.quota_runtime.current_window_used = ctx
                    .accounts
                    .quota_runtime
                    .current_window_used
                    .checked_add(1)
                    .ok_or(GatekeeperError::MathOverflow)?;
                allowed = true;
                reason = DecisionReason::Allowed;
            }
        }
    }

    let sequence = append_runtime_audit(
        &mut ctx.accounts.quota_runtime,
        action,
        allowed,
        reason,
        now,
    )?;

    emit!(RequestConsumed {
        organization: ctx.accounts.organization.key(),
        api_key: ctx.accounts.api_key.key(),
        quota_runtime: ctx.accounts.quota_runtime.key(),
        role: ctx.accounts.role.key(),
        action,
        allowed,
        reason: reason.code(),
        sequence,
        timestamp: now,
        quota_used: ctx.accounts.quota_runtime.current_window_used,
        quota_limit: ctx.accounts.quota_policy.max_requests,
    });

    Ok(())
}

