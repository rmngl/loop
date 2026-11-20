CREATE TABLE companies (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    mission TEXT NOT NULL,
    archived_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    goal TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE agents (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id),
    title TEXT NOT NULL,
    adapter_kind TEXT NOT NULL,
    adapter_config TEXT NOT NULL DEFAULT '{}',
    cron TEXT NOT NULL,
    monthly_budget_usd REAL NOT NULL,
    parent_agent_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    paused_reason TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE tickets (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id),
    project_id TEXT REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    assignee_agent_id TEXT REFERENCES agents(id),
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL REFERENCES companies(id),
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE trace_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL REFERENCES companies(id),
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    name TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE budget_periods (
    company_id TEXT NOT NULL REFERENCES companies(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    used_usd REAL NOT NULL DEFAULT 0,
    cap_usd REAL NOT NULL,
    PRIMARY KEY (company_id, agent_id, year, month)
);

CREATE TABLE approvals (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id),
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE TABLE audit_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL REFERENCES companies(id),
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    ticket_id TEXT REFERENCES tickets(id),
    status TEXT NOT NULL,
    error_message TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE INDEX idx_agents_company ON agents(company_id);
CREATE INDEX idx_tickets_company ON tickets(company_id);
CREATE INDEX idx_audit_company ON audit_entries(company_id, created_at);