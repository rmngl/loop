import { useCallback, useEffect, useState } from "react";
import { api, type ToolEvaluateResult, type ToolInvokeResult, type ToolPolicyRow } from "../api/loopd";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useCompany } from "../context/CompanyContext";

function tone(d: string): "success" | "warn" | "danger" {
  if (d === "block") return "danger";
  if (d === "ask") return "warn";
  return "success";
}

function formatProbe(r: ToolEvaluateResult): string {
  let msg = `${r.disposition} — allowed=${r.allowed}`;
  if (r.matched_pattern) msg += ` (${r.matched_pattern})`;
  if (r.grant_id) msg += ` · grant ${r.grant_id.slice(0, 8)}…`;
  if (r.pending_approval_id) msg += ` · pending approval ${r.pending_approval_id.slice(0, 8)}…`;
  return msg;
}

export function ToolsPage() {
  const { activeCompanyId } = useCompany();
  const [policies, setPolicies] = useState<ToolPolicyRow[]>([]);
  const [pattern, setPattern] = useState("mcp:*");
  const [disposition, setDisposition] = useState("allow");
  const [probeTool, setProbeTool] = useState("mcp:github:create_pr");
  const [lastProbe, setLastProbe] = useState<ToolEvaluateResult | null>(null);
  const [lastInvoke, setLastInvoke] = useState<ToolInvokeResult | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);

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
    setLastProbe(r);
    setLastInvoke(null);
    setInvokeError(null);
  }

  async function invokeStub() {
    if (!activeCompanyId) return;
    setInvokeError(null);
    try {
      const r = await api.invokeTool(activeCompanyId, probeTool, undefined, { probe: true });
      setLastInvoke(r);
      await probe();
    } catch (e) {
      setLastInvoke(null);
      setInvokeError(e instanceof Error ? e.message : String(e));
    }
  }

  async function requestUse() {
    if (!activeCompanyId) return;
    const r = await api.requestToolUse(activeCompanyId, probeTool);
    if (r.status === "pending" && r.approval_id) {
      alert(`Approval queued (${r.approval_id}). Open Approvals to allow one use.`);
    } else if (r.status === "already_granted" && r.grant_id) {
      alert(`Already have grant ${r.grant_id}. Evaluate again to consume.`);
    }
    await probe();
  }

  async function consumeGrant() {
    if (!activeCompanyId || !lastProbe?.grant_id) return;
    await api.consumeToolGrant(activeCompanyId, lastProbe.grant_id);
    await probe();
  }

  if (!activeCompanyId) {
    return <EmptyState title="Select a company" description="Tool policies are scoped per organization." />;
  }

  const showRequestUse =
    lastProbe?.disposition === "ask" && !lastProbe.allowed && !lastProbe.pending_approval_id;
  const showConsume = Boolean(lastProbe?.allowed && lastProbe.grant_id);
  const showInvoke = Boolean(lastProbe?.allowed);

  return (
    <div>
      <PageHeader
        title="Tool gateway"
        description="MCP/tool allow · ask · block (Paperclip-style). Ask → Approvals → grant; Invoke runs the policy-gated stub (consumes grant when applicable)."
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
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <input value={probeTool} onChange={(e) => setProbeTool(e.target.value)} style={{ flex: 1, minWidth: "12rem" }} />
          <button type="button" className="secondary" onClick={() => probe().catch(alert)}>
            Evaluate
          </button>
          {showRequestUse && (
            <button type="button" onClick={() => requestUse().catch(alert)}>
              Request use
            </button>
          )}
          {showConsume && (
            <button type="button" className="secondary" onClick={() => consumeGrant().catch(alert)}>
              Consume grant
            </button>
          )}
          {showInvoke && (
            <button type="button" onClick={() => invokeStub().catch(alert)}>
              Invoke (stub)
            </button>
          )}
        </div>
        {lastProbe && (
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            <Badge tone={tone(lastProbe.disposition)}>{lastProbe.disposition}</Badge>{" "}
            {formatProbe(lastProbe)}
          </p>
        )}
        {lastProbe?.pending_approval_id && (
          <p className="muted" style={{ marginTop: "0.35rem", fontSize: "0.9rem" }}>
            Waiting on board approval — see Approvals tab.
          </p>
        )}
        {invokeError && (
          <p className="muted" style={{ marginTop: "0.5rem", color: "var(--color-danger, #c44)" }}>
            Invoke denied: {invokeError}
          </p>
        )}
        {lastInvoke && (
          <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            Invoke: <code>{lastInvoke.status}</code>
            {lastInvoke.grant_consumed ? " · grant consumed" : ""} —{" "}
            <code>{JSON.stringify(lastInvoke.result)}</code>
          </p>
        )}
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