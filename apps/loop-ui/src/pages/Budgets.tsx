import { useCallback, useEffect, useState } from "react";
import { api, type BudgetRow, type CompanyBudgetRollup } from "../api/loopd";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useCompany } from "../context/CompanyContext";

export function BudgetsPage() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [companyRollup, setCompanyRollup] = useState<CompanyBudgetRollup | null>(null);
  const [increaseAgent, setIncreaseAgent] = useState("");
  const [newCap, setNewCap] = useState(100);
  const [companyCapInput, setCompanyCapInput] = useState("");
  const [savingCompanyCap, setSavingCompanyCap] = useState(false);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const data = await api.listBudgets(activeCompanyId);
    setRows(data.agents);
    setCompanyRollup(data.company ?? null);
    if (data.company) {
      setCompanyCapInput(String(data.company.cap_usd));
    }
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

  async function saveCompanyCap() {
    if (!activeCompanyId) return;
    setSavingCompanyCap(true);
    try {
      const trimmed = companyCapInput.trim();
      const value = trimmed === "" ? null : Number(trimmed);
      if (value !== null && (Number.isNaN(value) || value < 0)) {
        alert("Enter a non-negative number or leave blank to remove the company cap.");
        return;
      }
      await api.updateCompanyMonthlyBudget(activeCompanyId, value);
      await load();
    } finally {
      setSavingCompanyCap(false);
    }
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
        description={`Per-agent caps total $${totalCap.toFixed(2)} (${totalRemaining.toFixed(2)} remaining). Company ceiling is separate (Paperclip-style org budget).`}
      />
      <div className="panel panel--hero" style={{ marginBottom: "1rem" }}>
        <h3>Company monthly ceiling</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Hard stop for all agent spend in this organization for the current month (80% warn, 100% blocks heartbeats).
        </p>
        {companyRollup ? (
          <p className="row" style={{ gap: "0.5rem", marginBottom: "0.75rem" }}>
            <Badge tone={companyRollup.exhausted ? "danger" : companyRollup.warn ? "warn" : "success"}>
              ${companyRollup.used_usd.toFixed(2)} / ${companyRollup.cap_usd.toFixed(2)} used
            </Badge>
            <span className="muted">${companyRollup.remaining_usd.toFixed(2)} left</span>
          </p>
        ) : (
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            No company cap set — only per-agent limits apply.
          </p>
        )}
        <div className="row">
          <input
            type="number"
            min={0}
            placeholder="Monthly USD (blank = remove cap)"
            value={companyCapInput}
            onChange={(e) => setCompanyCapInput(e.target.value)}
            style={{ minWidth: "12rem" }}
          />
          <button type="button" disabled={savingCompanyCap} onClick={() => saveCompanyCap().catch(alert)}>
            Save company cap
          </button>
        </div>
      </div>
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