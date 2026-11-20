import { useCallback, useEffect, useState } from "react";
import { api, type AgentRow } from "../api/loopd";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useCompany } from "../context/CompanyContext";

export function OrgPage() {
  const { activeCompanyId } = useCompany();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [title, setTitle] = useState("CEO");
  const [adapterKind, setAdapterKind] = useState("mock");
  const [cron, setCron] = useState("0 */4 * * *");
  const [budget, setBudget] = useState(60);
  const [hermesBin, setHermesBin] = useState("hermes");
  const [processCmd, setProcessCmd] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [reportsTo, setReportsTo] = useState("");

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const data = await api.listAgents(activeCompanyId);
    setAgents(data.agents);
  }, [activeCompanyId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function hire() {
    if (!activeCompanyId) return;
    let adapter_config: Record<string, unknown> | undefined;
    if (adapterKind === "hermes") {
      adapter_config = { hermes_bin: hermesBin };
    } else if (adapterKind === "process" && processCmd.trim()) {
      adapter_config = { command: processCmd.trim(), args: [] };
    } else if (adapterKind === "webhook" && webhookUrl.trim()) {
      adapter_config = { url: webhookUrl.trim() };
    }
    const { approval_id } = await api.hireAgent(activeCompanyId, {
      title,
      adapter_kind: adapterKind,
      cron,
      monthly_budget_usd: budget,
      adapter_config,
      parent_agent_id: reportsTo || null,
    });
    alert(
      `Hire submitted (approval ${approval_id}). Open the Approvals tab to approve before the agent becomes active.`
    );
    await load();
  }

  if (!activeCompanyId) {
    return <EmptyState title="Select a company" description="Hire and manage agents for the active company." />;
  }

  return (
    <div>
      <PageHeader
        title="Org chart"
        description="Reporting lines like Paperclip: hire with a manager, then approve on the board."
      />
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h3>Hire agent</h3>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Role title" />
          <select
            value={reportsTo}
            onChange={(e) => setReportsTo(e.target.value)}
            aria-label="Reports to"
            title="Reports to"
          >
            <option value="">No manager (top of org)</option>
            {agents
              .filter((a) => a.status === "active")
              .map((a) => (
                <option key={a.agent_id} value={a.agent_id}>
                  {a.title}
                </option>
              ))}
          </select>
          <select value={adapterKind} onChange={(e) => setAdapterKind(e.target.value)}>
            <option value="mock">mock</option>
            <option value="hermes">hermes</option>
            <option value="process">process</option>
            <option value="webhook">webhook</option>
          </select>
          <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="Cron" />
          <input
            type="number"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            placeholder="Monthly USD"
          />
          <button type="button" onClick={() => hire().catch(alert)}>
            Hire (with board approval)
          </button>
        </div>
        {adapterKind === "hermes" && (
          <input
            style={{ marginTop: "0.75rem", width: "100%" }}
            value={hermesBin}
            onChange={(e) => setHermesBin(e.target.value)}
            placeholder="Hermes binary path or name"
          />
        )}
        {adapterKind === "process" && (
          <input
            style={{ marginTop: "0.75rem", width: "100%" }}
            value={processCmd}
            onChange={(e) => setProcessCmd(e.target.value)}
            placeholder="Process adapter command path"
          />
        )}
        {adapterKind === "webhook" && (
          <input
            style={{ marginTop: "0.75rem", width: "100%" }}
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="Webhook URL (POST HeartbeatIn)"
          />
        )}
      </div>
      <div className="panel">
        <table className="data-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Reports to</th>
            <th>Adapter</th>
            <th>Status</th>
            <th>Cron</th>
            <th>Budget</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.agent_id}>
              <td>{a.title}</td>
              <td className="muted">
                {a.parent_agent_id
                  ? agents.find((p) => p.agent_id === a.parent_agent_id)?.title ?? a.parent_agent_id.slice(0, 8)
                  : "—"}
              </td>
              <td>{a.adapter_kind}</td>
              <td>
                <Badge tone={a.status === "active" ? "success" : a.paused_reason ? "warn" : "pending"}>
                  {a.status}
                  {a.paused_reason ? ` · ${a.paused_reason}` : ""}
                </Badge>
              </td>
              <td>{a.cron}</td>
              <td>${a.monthly_budget_usd}</td>
              <td>
                {a.status === "active" && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      api.triggerHeartbeat(activeCompanyId, a.agent_id).then(load).catch(alert)
                    }
                  >
                    Heartbeat
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}