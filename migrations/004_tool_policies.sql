-- Paperclip-style tool gateway stub: per-company MCP/tool disposition.
CREATE TABLE tool_policies (
    company_id TEXT NOT NULL REFERENCES companies(id),
    tool_pattern TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK (disposition IN ('allow', 'ask', 'block')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (company_id, tool_pattern)
);