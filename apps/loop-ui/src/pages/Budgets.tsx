import { useCallback, useEffect, useState } from "react";
import { api, type BudgetRow } from "../api/loopd";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useCompany } from "../context/CompanyContext";

export function BudgetsPage() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [increaseAgent, setIncreaseAgent] = useState("");
  const [newCap, setNewCap] = useState(100);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const data = await api.listBudgets(activeCompanyId);
    setRows(data.agents);
    if (data.agents.length > 0) {
      setIncreaseAgent((prev) => prev || data.agents[0].agent_id);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function requestIncrease() {
    if (!activeCompanyId || !increaseAgent) return;
    const res = await api.requestBudgetIncrease(activeCompanyId, increaseAgent, newCap);
    alert(`Budget increase pending. Approve approval ${res.approval_id} on the Approvals tab.`);
    await load();
  }

  if (!activeCompanyId) {
    return <EmptyState title="Select a company" description="Monthly agent caps and board-approved increases." />;
  }

  const totalCap = rows.reduce((s, r) => s + r.cap_usd, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.remaining_usd, 0);

  return (
    <div>
      <PageHeader
        title="Budgets"
        description={`Remaining $${totalRemaining.toFixed(2)} of $${totalCap.toFixed(2)} in monthly caps — 80% warn, 100% hard stop.`}
      />
      <div className="panel" style={{ marginTop: "1rem", marginBottom: "1rem" }}>
        <h3>Request cap increase</h3>
        <div className="row">
          <select value={increaseAgent} onChange={(e) => setIncreaseAgent(e.target.value)}>
            {rows.map((r) => (
              <option key={r.agent_id} value={r.agent_id}>
                {r.title}
              </option>
            ))}
          </select>
          <input type="number" value={newCap} onChange={(e) => setNewCap(Number(e.target.value))} />
          <button type="button" onClick={() => requestIncrease().catch(alert)}>
            Request board approval
          </button>
        </div>
      </div>
      <div className="panel">
        <table className="data-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Remaining</th>
            <th>Cap</th>
            <th>Paused</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const used = r.cap_usd - r.remaining_usd;
            const pct = r.cap_usd > 0 ? (used / r.cap_usd) * 100 : 0;
            return (
              <tr key={r.agent_id}>
                <td>{r.title}</td>
                <td>${r.remaining_usd.toFixed(2)}</td>
                <td>${r.cap_usd.toFixed(2)}</td>
                <td>
                  {r.paused_reason ? <Badge tone="danger">{r.paused_reason}</Badge> : "—"}
                  {pct >= 80 && pct < 100 && !r.paused_reason && <Badge tone="warn">80%+ used</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </div>
  );
}