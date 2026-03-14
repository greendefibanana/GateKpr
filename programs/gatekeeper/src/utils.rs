use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::GatekeeperError,
    state::{QuotaPolicy, QuotaRuntime, Role, RuntimeAuditRecord},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Action {
    MetricsRead = 0,
    MetricsWrite = 1,
    UsersRead = 2,
    UsersWrite = 3,
    Admin = 4,
}

impl TryFrom<u8> for Action {
    type Error = GatekeeperError;

    fn try_from(value: u8) -> std::result::Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::MetricsRead),
            1 => Ok(Self::MetricsWrite),
            2 => Ok(Self::UsersRead),
            3 => Ok(Self::UsersWrite),
            4 => Ok(Self::Admin),
            _ => Err(GatekeeperError::InvalidAction),
        }
    }
}

impl Action {
    pub fn permission_mask(self) -> u64 {
        match self {
            Self::MetricsRead => PERMISSION_METRICS_READ,
            Self::MetricsWrite => PERMISSION_METRICS_WRITE,
            Self::UsersRead => PERMISSION_USERS_READ,
            Self::UsersWrite => PERMISSION_USERS_WRITE,
            Self::Admin => PERMISSION_ADMIN,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum DecisionReason {
    Allowed = 0,
    Unauthorized = 1,
    KeyRevoked = 2,
    QuotaExceeded = 3,
    InvalidAction = 4,
}

impl DecisionReason {
    pub fn code(self) -> u8 {
        self as u8
    }
}

pub fn current_timestamp() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

pub fn validate_name(name: &str) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, GatekeeperError::NameTooLong);
    Ok(())
}

pub fn validate_label(label: &str) -> Result<()> {
    require!(label.len() <= MAX_LABEL_LEN, GatekeeperError::LabelTooLong);
    Ok(())
}

pub fn validate_policy_mask(mask: u64) -> Result<()> {
    require!(
        mask & !ALL_PERMISSIONS_MASK == 0,
        GatekeeperError::InvalidPolicyMask
    );
    Ok(())
}

pub fn role_allows(role: &Role, action: Action) -> bool {
    let admin_allowed = role.policy_mask & PERMISSION_ADMIN != 0;
    admin_allowed || role.policy_mask & action.permission_mask() != 0
}

pub fn reset_runtime_if_expired(
    quota_runtime: &mut QuotaRuntime,
    quota_policy: &QuotaPolicy,
    now: i64,
) -> Result<()> {
    let window_ends_at = quota_runtime
        .current_window_started_at
        .checked_add(quota_policy.window_seconds)
        .ok_or(GatekeeperError::MathOverflow)?;

    if now >= window_ends_at {
        quota_runtime.current_window_used = 0;
        quota_runtime.current_window_started_at = now;
    }

    Ok(())
}

pub fn append_runtime_audit(
    quota_runtime: &mut QuotaRuntime,
    action: u8,
    allowed: bool,
    reason: DecisionReason,
    now: i64,
) -> Result<u64> {
    quota_runtime.rolling_sequence = quota_runtime
        .rolling_sequence
        .checked_add(1)
        .ok_or(GatekeeperError::MathOverflow)?;

    if allowed {
        quota_runtime.total_allowed = quota_runtime
            .total_allowed
            .checked_add(1)
            .ok_or(GatekeeperError::MathOverflow)?;
    } else {
        quota_runtime.total_rejected = quota_runtime
            .total_rejected
            .checked_add(1)
            .ok_or(GatekeeperError::MathOverflow)?;
    }

    quota_runtime.last_action = action;
    quota_runtime.last_reason = reason.code();
    quota_runtime.last_request_at = now;
    quota_runtime.rolling_audit.push(RuntimeAuditRecord {
        sequence: quota_runtime.rolling_sequence,
        action,
        allowed,
        reason: reason.code(),
        timestamp: now,
        quota_used_after: quota_runtime.current_window_used,
    });

    if quota_runtime.rolling_audit.len() > MAX_RUNTIME_AUDIT_ITEMS {
        quota_runtime.rolling_audit.remove(0);
    }

    Ok(quota_runtime.rolling_sequence)
}
