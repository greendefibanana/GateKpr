use anchor_lang::prelude::*;

#[event]
pub struct GatewayInitialized {
    pub gateway: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct OrganizationCreated {
    pub organization: Pubkey,
    pub authority: Pubkey,
    pub name: String,
}

#[event]
pub struct RoleCreated {
    pub organization: Pubkey,
    pub role: Pubkey,
    pub name: String,
}

#[event]
pub struct PolicyAttached {
    pub organization: Pubkey,
    pub role: Pubkey,
    pub policy_mask: u64,
}

#[event]
pub struct ApiKeyCreated {
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub role: Pubkey,
    pub key_id: Pubkey,
    pub label: String,
}

#[event]
pub struct QuotaPolicyConfigured {
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub quota_policy: Pubkey,
    pub max_requests: u64,
    pub window_seconds: i64,
}

#[event]
pub struct QuotaRuntimeInitialized {
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub quota_runtime: Pubkey,
    pub audit_checkpoint: Pubkey,
}

#[event]
pub struct QuotaRuntimeDelegated {
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub quota_runtime: Pubkey,
    pub commit_frequency_ms: u32,
    pub validator: Pubkey,
}

#[event]
pub struct QuotaRuntimeCommitted {
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub quota_runtime: Pubkey,
    pub sequence: u64,
    pub still_delegated: bool,
}

#[event]
pub struct AuditCheckpointSettled {
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub quota_runtime: Pubkey,
    pub audit_checkpoint: Pubkey,
    pub settled_sequence: u64,
    pub settled_at: i64,
}

#[event]
pub struct RequestConsumed {
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub quota_runtime: Pubkey,
    pub role: Pubkey,
    pub action: u8,
    pub allowed: bool,
    pub reason: u8,
    pub sequence: u64,
    pub timestamp: i64,
    pub quota_used: u64,
    pub quota_limit: u64,
}

#[event]
pub struct ApiKeyRevoked {
    pub organization: Pubkey,
    pub api_key: Pubkey,
    pub revoked_at: i64,
}
