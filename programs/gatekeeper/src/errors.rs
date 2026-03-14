use anchor_lang::prelude::*;

#[error_code]
pub enum GatekeeperError {
    #[msg("Unauthorized action for the assigned role")]
    Unauthorized,
    #[msg("API key has been revoked")]
    KeyRevoked,
    #[msg("Quota window has been exhausted")]
    QuotaExceeded,
    #[msg("Invalid action identifier")]
    InvalidAction,
    #[msg("Quota runtime is already initialized")]
    RuntimeAlreadyInitialized,
    #[msg("Quota runtime is already delegated")]
    RuntimeAlreadyDelegated,
    #[msg("Quota runtime is not delegated")]
    RuntimeNotDelegated,
    #[msg("Quota runtime must be undelegated before settlement")]
    RuntimeStillDelegated,
    #[msg("Signer is not authorized for this organization")]
    InvalidOrganizationAuthority,
    #[msg("Role already exists for this organization")]
    DuplicateRole,
    #[msg("API key already exists for this organization")]
    DuplicateKey,
    #[msg("Organization already exists for this seed")]
    DuplicateOrganization,
    #[msg("Invalid quota configuration")]
    InvalidQuotaConfig,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Invalid policy mask")]
    InvalidPolicyMask,
    #[msg("Provided organization name is too long")]
    NameTooLong,
    #[msg("Provided API key label is too long")]
    LabelTooLong,
    #[msg("Role does not belong to the provided organization")]
    RoleOrganizationMismatch,
    #[msg("API key does not belong to the provided organization")]
    ApiKeyOrganizationMismatch,
    #[msg("API key is not attached to the provided role")]
    ApiKeyRoleMismatch,
    #[msg("Quota policy does not belong to the provided API key")]
    QuotaPolicyMismatch,
    #[msg("Quota runtime does not match the provided API key or organization")]
    QuotaRuntimeMismatch,
    #[msg("Audit checkpoint does not match the provided runtime")]
    AuditCheckpointMismatch,
    #[msg("Invalid runtime commit frequency")]
    InvalidCommitFrequency,
}
