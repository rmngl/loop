-- One-shot board approval for tool_use (Paperclip-style ask disposition).
CREATE TABLE tool_use_grants (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id),
    tool_name TEXT NOT NULL,
    agent_id TEXT REFERENCES agents(id),
    used_at TEXT,
    created_at TEXT NOT NULL
);