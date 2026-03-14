pub const MAX_NAME_LEN: usize = 32;
pub const MAX_LABEL_LEN: usize = 48;
pub const MAX_RUNTIME_AUDIT_ITEMS: usize = 8;

pub const SEED_GATEWAY: &[u8] = b"gateway";
pub const SEED_ORGANIZATION: &[u8] = b"organization";
pub const SEED_ROLE: &[u8] = b"role";
pub const SEED_API_KEY: &[u8] = b"api_key";
pub const SEED_QUOTA_POLICY: &[u8] = b"quota_policy";
pub const SEED_QUOTA_RUNTIME: &[u8] = b"quota_runtime";
pub const SEED_AUDIT_CHECKPOINT: &[u8] = b"audit_checkpoint";

pub const PERMISSION_METRICS_READ: u64 = 1 << 0;
pub const PERMISSION_METRICS_WRITE: u64 = 1 << 1;
pub const PERMISSION_USERS_READ: u64 = 1 << 2;
pub const PERMISSION_USERS_WRITE: u64 = 1 << 3;
pub const PERMISSION_ADMIN: u64 = 1 << 4;
pub const ALL_PERMISSIONS_MASK: u64 = PERMISSION_METRICS_READ
    | PERMISSION_METRICS_WRITE
    | PERMISSION_USERS_READ
    | PERMISSION_USERS_WRITE
    | PERMISSION_ADMIN;

pub const DEFAULT_VALIDATOR: [u8; 32] = [0; 32];
