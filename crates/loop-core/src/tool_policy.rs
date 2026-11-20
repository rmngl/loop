use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolDisposition {
    Allow,
    Ask,
    Block,
}

impl ToolDisposition {
    pub fn as_str(self) -> &'static str {
        match self {
            ToolDisposition::Allow => "allow",
            ToolDisposition::Ask => "ask",
            ToolDisposition::Block => "block",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "allow" => Some(ToolDisposition::Allow),
            "ask" => Some(ToolDisposition::Ask),
            "block" => Some(ToolDisposition::Block),
            _ => None,
        }
    }
}