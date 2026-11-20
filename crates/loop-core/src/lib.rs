pub mod adapter;
pub mod domain;
pub mod error;
pub mod ids;
pub mod paths;
pub mod tool_policy;

pub const VERSION: &str = "0.1.0";

#[cfg(test)]
mod tests {
    #[test]
    fn workspace_smoke() {
        assert_eq!(super::VERSION, "0.1.0");
    }
}