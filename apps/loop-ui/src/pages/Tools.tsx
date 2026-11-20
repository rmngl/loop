import { useCallback, useEffect, useState } from "react";
import { api, type ToolPolicyRow } from "../api/loopd";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useCompany } from "../context/CompanyContext";

function tone(d: string): "success" | "warn" | "danger" {
  if (d === "block") return "danger";
  if (d === "ask") return "warn";
  return "success";
}

export function ToolsPage() {
  const { activeCompanyId } = useCompany();
  const [policies, setPolicies] = useState<ToolPolicyRow[]>([]);
  const [pattern, setPattern] = useState("mcp:*");
  const [disposition, setDisposition] = useState("allow");
  const [probeTool, setProbeTool] = useState("mcp:github:create_pr");
  const [probeResult, setProbeResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const data = await api.listToolPolicies(activeCompanyId);
    setPolicies(data.policies);
  }, [activeCompanyId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function savePolicy() {
    if (!activeCompanyId) return;
    await api.upsertToolPolicy(activeCompanyId, pattern, disposition);
    await load();
  }

  async function removePolicy(p: string) {
    if (!activeCompanyId) return;
    await api.removeToolPolicy(activeCompanyId, p);
    await load();
  }

  async function probe() {
    if (!activeCompanyId) return;
    const r = await api.evaluateTool(activeCompanyId, probeTool);
    setProbeResult(`${r.disposition}${r.matched_pattern ? ` (matched ${r.matched_pattern})` : ""}`);
  }

  if (!activeCompanyId) {
    return <EmptyState title="Select a company" description="Tool policies are scoped per organization." />;
  }

  return (
    <div>
      <PageHeader
        title="Tool gateway"
        description="MCP/tool allow · ask · block (Paperclip-style). Evaluation only — adapters call evaluate before running tools."
      />
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h3>Add policy</h3>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input
            placeholder="Pattern (e.g. mcp:secrets:*)"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            style={{ minWidth: "14rem" }}
          />
          <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
            <option value="allow">allow</option>
            <option value="ask">ask</option>
            <option value="block">block</option>
          </select>
          <button type="button" onClick={() => savePolicy().catch(alert)}>
            Save
          </button>
        </div>
      </div>
      <div className="panel panel--inset" style={{ marginBottom: "1rem" }}>
        <h3>Probe</h3>
        <div className="row">
          <input value={probeTool} onChange={(e) => setProbeTool(e.target.value)} style={{ flex: 1 }} />
          <button type="button" className="secondary" onClick={() => probe().catch(alert)}>
            Evaluate
          </button>
        </div>
        {probeResult && <p className="muted" style={{ marginTop: "0.5rem" }}>{probeResult}</p>}
      </div>
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Disposition</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.tool_pattern}>
                <td>
                  <code>{p.tool_pattern}</code>
                </td>
                <td>
                  <Badge tone={tone(p.disposition)}>{p.disposition}</Badge>
                </td>
                <td>
                  <button type="button" className="ghost" onClick={() => removePolicy(p.tool_pattern).catch(alert)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {policies.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No policies — all tools allowed.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}