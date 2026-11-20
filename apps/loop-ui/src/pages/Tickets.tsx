import { useCallback, useEffect, useState } from "react";
import { api, type AgentRow, type ProjectRow, type TicketMessageRow, type TicketRow } from "../api/loopd";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useCompany } from "../context/CompanyContext";

function statusTone(status: string): "default" | "success" | "warn" | "strategy" | "pending" {
  if (status === "open" || status === "in_progress") return "success";
  if (status === "in_review") return "pending";
  if (status === "blocked") return "warn";
  return "default";
}

type TicketsPageProps = {
  onWorkflowChange?: () => void;
};

export function TicketsPage({ onWorkflowChange }: TicketsPageProps) {
  const { activeCompanyId } = useCompany();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [traces, setTraces] = useState<unknown[]>([]);
  const [messages, setMessages] = useState<TicketMessageRow[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [strategyTag, setStrategyTag] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [boardMsg, setBoardMsg] = useState("");
  const [reviewerPick, setReviewerPick] = useState("");

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const [t, a, p] = await Promise.all([
      api.listTickets(activeCompanyId),
      api.listAgents(activeCompanyId),
      api.listProjects(activeCompanyId),
    ]);
    setTickets(t.tickets);
    setAgents(a.agents.filter((x) => x.status === "active"));
    setProjects(p.projects);
  }, [activeCompanyId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function openTicket(id: string) {
    if (!activeCompanyId) return;
    setSelected(id);
    const detail = await api.getTicket(activeCompanyId, id);
    setTraces(detail.traces);
    setMessages(detail.messages);
    setReviewerPick(detail.ticket.reviewer_agent_id ?? "");
  }

  async function saveReviewer() {
    if (!activeCompanyId || !selected) return;
    await api.setTicketReviewer(activeCompanyId, selected, reviewerPick || null);
    await load();
    await openTicket(selected);
  }

  async function create() {
    if (!activeCompanyId || !title.trim()) return;
    const tags = strategyTag ? ["strategy"] : [];
    const created = await api.createTicket(
      activeCompanyId,
      title.trim(),
      description,
      tags,
      projectId || undefined
    );
    setTitle("");
    setDescription("");
    setStrategyTag(false);
    setProjectId("");
    if (created.strategy_approval_id) {
      alert(
        `Strategy ticket created. Approve approval ${created.strategy_approval_id} on the Approvals tab before assigning.`
      );
    }
    await load();
  }

  async function assign(ticketId: string, agentId: string) {
    if (!activeCompanyId) return;
    try {
      await api.assignTicket(activeCompanyId, ticketId, agentId);
    } catch (e) {
      alert(String(e));
      return;
    }
    await load();
    if (selected === ticketId) await openTicket(ticketId);
  }

  async function sendBoardMessage() {
    if (!activeCompanyId || !selected || !boardMsg.trim()) return;
    await api.postTicketMessage(activeCompanyId, selected, "Board", boardMsg.trim());
    setBoardMsg("");
    await openTicket(selected);
  }

  async function submitForReview() {
    if (!activeCompanyId || !selected) return;
    await api.submitTicketReview(activeCompanyId, selected);
    await load();
    await openTicket(selected);
    onWorkflowChange?.();
  }

  async function approveDone() {
    if (!activeCompanyId || !selected) return;
    await api.approveTicketDone(activeCompanyId, selected);
    await load();
    await openTicket(selected);
    onWorkflowChange?.();
  }

  async function requestChanges() {
    if (!activeCompanyId || !selected) return;
    await api.requestTicketChanges(activeCompanyId, selected);
    await load();
    await openTicket(selected);
    onWorkflowChange?.();
  }

  if (!activeCompanyId) {
    return (
      <EmptyState title="Select a company" description="Open work and agent traces appear here per company." />
    );
  }

  const selectedTicket = tickets.find((t) => t.ticket_id === selected);

  return (
    <div>
      <PageHeader title="Tickets" description="Work queue, board thread with agents, and heartbeat trace." />
      <div className="tickets-layout">
        <div>
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <h3>New ticket</h3>
            <input
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: "100%", marginBottom: "0.5rem" }}
            />
            <textarea
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ width: "100%" }}
            />
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ width: "100%", marginTop: "0.5rem" }}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.65rem", fontSize: "0.9rem" }}>
              <input type="checkbox" checked={strategyTag} onChange={(e) => setStrategyTag(e.target.checked)} />
              <span>
                Strategy tag <Badge tone="strategy">approval</Badge>
              </span>
            </label>
            <button type="button" style={{ marginTop: "0.75rem" }} onClick={() => create().catch(alert)}>
              Create ticket
            </button>
          </div>
          <TicketTable tickets={tickets} agents={agents} selected={selected} onOpen={openTicket} onAssign={assign} />
        </div>

        {selected ? (
          <div className="ticket-detail">
            <PageHeader
              title={selectedTicket?.title ?? "Ticket"}
              description={
                selectedTicket?.status === "in_review"
                  ? "Agent work is ready — verify trace and approve or request changes (Paperclip-style review gate)."
                  : selectedTicket?.status
                    ? `Status: ${selectedTicket.status}`
                    : undefined
              }
              actions={
                selectedTicket?.status === "in_progress" ? (
                  <button type="button" className="secondary" onClick={() => submitForReview().catch(alert)}>
                    Submit for review
                  </button>
                ) : selectedTicket?.status === "in_review" ? (
                  <div className="row" style={{ gap: "0.5rem" }}>
                    <button type="button" onClick={() => approveDone().catch(alert)}>
                      Approve done
                    </button>
                    <button type="button" className="secondary" onClick={() => requestChanges().catch(alert)}>
                      Request changes
                    </button>
                  </div>
                ) : undefined
              }
            />
            <div className="panel panel--inset" style={{ marginBottom: "1rem" }}>
              <h3>Reviewer</h3>
              <p className="muted" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
                Paperclip-style reviewer agent — woken on submit (defaults to assignee’s Reports to).
              </p>
              <div className="row">
                <select
                  aria-label="Reviewer agent"
                  value={reviewerPick}
                  onChange={(e) => setReviewerPick(e.target.value)}
                >
                  <option value="">Auto — manager on submit</option>
                  {agents.map((a) => (
                    <option key={a.agent_id} value={a.agent_id}>
                      {a.title}
                    </option>
                  ))}
                </select>
                <button type="button" className="secondary" onClick={() => saveReviewer().catch(alert)}>
                  Save reviewer
                </button>
              </div>
              {selectedTicket?.reviewer_agent_id && (
                <p className="muted" style={{ marginBottom: 0, marginTop: "0.5rem", fontSize: "0.85rem" }}>
                  Active reviewer:{" "}
                  {agents.find((a) => a.agent_id === selectedTicket.reviewer_agent_id)?.title ??
                    selectedTicket.reviewer_agent_id.slice(0, 8)}
                </p>
              )}
            </div>
            <div className="panel" style={{ marginBottom: "1rem" }}>
              <h3>Board thread</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {messages.map((m, i) => (
                  <li
                    key={i}
                    style={{
                      marginBottom: "0.75rem",
                      paddingBottom: "0.75rem",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <strong>{m.author}</strong>
                    <div style={{ marginTop: "0.25rem" }}>{m.body}</div>
                    <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                      {m.created_at}
                    </div>
                  </li>
                ))}
                {messages.length === 0 && <li className="muted">No messages yet</li>}
              </ul>
              <textarea
                rows={2}
                style={{ width: "100%", marginTop: "0.75rem" }}
                placeholder="Message to agent"
                value={boardMsg}
                onChange={(e) => setBoardMsg(e.target.value)}
              />
              <button type="button" className="secondary" style={{ marginTop: "0.35rem" }} onClick={() => sendBoardMessage().catch(alert)}>
                Post to board
              </button>
            </div>
            <div className="panel">
              <h3>Heartbeat trace</h3>
              <pre className="trace-block">{JSON.stringify(traces, null, 2)}</pre>
            </div>
          </div>
        ) : (
          <div className="panel ticket-detail muted" style={{ textAlign: "center", padding: "2.5rem" }}>
            Select a ticket to view thread and trace
          </div>
        )}
      </div>
    </div>
  );
}

function TicketTable({
  tickets,
  agents,
  selected,
  onOpen,
  onAssign,
}: {
  tickets: TicketRow[];
  agents: AgentRow[];
  selected: string | null;
  onOpen: (id: string) => void;
  onAssign: (ticketId: string, agentId: string) => Promise<void>;
}) {
  return (
    <div className="panel">
      <table className="data-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Assign</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.ticket_id} className={selected === t.ticket_id ? "is-selected" : ""}>
              <td>
                <button type="button" className="ghost" onClick={() => onOpen(t.ticket_id)} style={{ padding: "0.25rem 0.5rem" }}>
                  {t.title}
                </button>
              </td>
              <td>
                <Badge tone={t.tags?.includes("strategy") ? "strategy" : statusTone(t.status)}>
                  {t.tags?.includes("strategy") ? "strategy" : t.status}
                </Badge>
              </td>
              <td>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) onAssign(t.ticket_id, v).catch(alert);
                  }}
                >
                  <option value="">—</option>
                  {agents.map((a) => (
                    <option key={a.agent_id} value={a.agent_id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {tickets.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No tickets yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}