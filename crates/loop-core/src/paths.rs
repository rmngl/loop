use std::path::{Path, PathBuf};

use crate::ids::CompanyId;

pub fn data_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("loop")
}

pub fn company_workspace(company_id: CompanyId) -> PathBuf {
    data_root()
        .join("companies")
        .join(company_id.to_string())
        .join("workspace")
}

pub fn ensure_company_workspace(company_id: CompanyId) -> std::io::Result<PathBuf> {
    let path = company_workspace(company_id);
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

pub fn db_path(custom: Option<&Path>) -> PathBuf {
    custom.map(Path::to_path_buf).unwrap_or_else(|| data_root().join("loop.db"))
}