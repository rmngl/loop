use thiserror::Error;

#[derive(Debug, Error)]
pub enum LoopError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("validation: {0}")]
    Validation(String),
    #[error("budget exhausted for agent")]
    BudgetExhausted,
    #[error("policy denied: {0}")]
    PolicyDenied(String),
    #[error("adapter failed: {0}")]
    AdapterFailed(String),
    #[error("database: {0}")]
    Database(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, LoopError>;