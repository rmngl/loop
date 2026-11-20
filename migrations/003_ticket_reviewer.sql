-- Designated reviewer agent for Paperclip-style review stage (board still approves in UI).
ALTER TABLE tickets ADD COLUMN reviewer_agent_id TEXT REFERENCES agents(id);