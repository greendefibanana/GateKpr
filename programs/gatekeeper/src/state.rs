use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct RuntimeAuditRecord {
    pub sequence: u64,
    pub action: u8,
    pub allowed: bool,
    pub reason: u8,
    pub timestamp: i64,
    pub quota_used_after: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Gateway {
    pub bump: u8,
    pub authority: Pubkey,
    pub organization_count: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Organization {
    pub initialized: bool,
    pub bump: u8,
    pub gateway: Pubkey,
    pub authority: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub role_count: u64,
    pub api_key_count: u64,
    pub settlement_count: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Role {
    pub initialized: bool,
    pub bump: u8,
    pub organization: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub policy_mask: u64,
    pub created_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct ApiKey {
    pub initialized: bool,
    pub bump: u8,
    pub organization: Pubkey,
    pub role: Pubkey,
    pub key_id: Pubkey,
    #[max_len(48)]
    pub label: String,
    pub active: bool,
    pub created_by: Pubkey,
    pub created_at: i64,
    pub revoked_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct QuotaPolicy {
    pub initialized: bool,
    pub bump: u8,
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub max_requests: u64,
    pub window_seconds: i64,
}

#[account]
#[derive(InitSpace)]
pub struct QuotaRuntime {
    pub initialized: bool,
    pub bump: u8,
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub quota_policy: Pubkey,
    pub delegated_validator: Pubkey,
    pub commit_frequency_ms: u32,
    pub is_delegated: bool,
    pub total_allowed: u64,
    pub total_rejected: u64,
    pub current_window_used: u64,
    pub current_window_started_at: i64,
    pub rolling_sequence: u64,
    pub last_action: u8,
    pub last_reason: u8,
    pub last_request_at: i64,
    pub last_settled_sequence: u64,
    pub last_settled_at: i64,
    #[max_len(8)]
    pub rolling_audit: Vec<RuntimeAuditRecord>,
}

#[account]
#[derive(InitSpace)]
pub struct AuditCheckpoint {
    pub initialized: bool,
    pub bump: u8,
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub quota_policy: Pubkey,
    pub settled_sequence: u64,
    pub total_allowed: u64,
    pub total_rejected: u64,
    pub current_window_used: u64,
    pub current_window_started_at: i64,
    pub last_action: u8,
    pub last_reason: u8,
    pub last_request_at: i64,
    pub last_settled_at: i64,
}
