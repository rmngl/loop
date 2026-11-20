import { useCallback, useEffect, useState } from "react";
import { api, type AgentRow, type ProjectRow, type TicketMessageRow, type TicketRow } from "../api/loopd";
import { useCompany } from "../context/CompanyContext";

export function TicketsPage() {
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

  if (!activeCompanyId) return <p className="muted">Select a company.</p>;

  return (
    <div className="row">
      <div style={{ flex: "1 1 360px" }}>
        <h2>Tickets</h2>
        <div className="panel" style={{ marginBottom: "1rem" }}>
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
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{ width: "100%", marginTop: "0.5rem" }}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.project_id} value={p.project_id}>
                {p.name}
              </option>
            ))}
          </select>
          <label style={{ display: "block", marginTop: "0.5rem" }}>
            <input
              type="checkbox"
              checked={strategyTag}
              onChange={(e) => setStrategyTag(e.target.checked)}
            />{" "}
            Strategy (requires board approval before assign)
          </label>
          <button type="button" style={{ marginTop: "0.5rem" }} onClick={() => create().catch(alert)}>
            Create ticket
          </button>
        </div>
        <table className="panel">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Assign</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.ticket_id}>
                <td>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      openTicket(t.ticket_id);
                    }}
                  >
                    {t.title}
                  </a>
                </td>
                <td>{t.status}</td>
                <td>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) assign(t.ticket_id, v).catch(alert);
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
          </tbody>
        </table>
      </div>
      {selected && (
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="panel">
            <h3>Thread</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {messages.map((m, i) => (
                <li key={i} style={{ marginBottom: "0.5rem" }}>
                  <strong>{m.author}</strong>
                  <div>{m.body}</div>
                  <div className="muted" style={{ fontSize: "0.75rem" }}>
                    {m.created_at}
                  </div>
                </li>
              ))}
              {messages.length === 0 && <li className="muted">No messages yet</li>}
            </ul>
            <textarea
              rows={2}
              style={{ width: "100%", marginTop: "0.5rem" }}
              placeholder="Board message to agent"
              value={boardMsg}
              onChange={(e) => setBoardMsg(e.target.value)}
            />
            <button type="button" className="secondary" style={{ marginTop: "0.25rem" }} onClick={() => sendBoardMessage().catch(alert)}>
              Post
            </button>
          </div>
          <div className="panel" style={{ maxHeight: "40vh", overflow: "auto" }}>
            <h3>Trace</h3>
            <pre style={{ fontSize: "0.8rem", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(traces, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}