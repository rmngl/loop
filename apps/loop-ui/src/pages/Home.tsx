import { useCallback, useEffect, useState } from "react";
import { api, type DashboardStats } from "../api/loopd";
import { useCompany } from "../context/CompanyContext";

export function HomePage() {
  const { activeCompanyId, mission, refreshCompanies, setActiveCompanyId, companies } = useCompany();
  const [name, setName] = useState("");
  const [newMission, setNewMission] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [missionEdit, setMissionEdit] = useState(mission ?? "");
  const [savingMission, setSavingMission] = useState(false);

  const loadStats = useCallback(async () => {
    if (!activeCompanyId) return;
    setStats(await api.dashboard(activeCompanyId));
  }, [activeCompanyId]);

  useEffect(() => {
    setMissionEdit(mission ?? "");
  }, [mission]);

  useEffect(() => {
    loadStats().catch(console.error);
  }, [loadStats]);

  async function createCompany() {
    if (!name.trim() || !newMission.trim()) return;
    setBusy(true);
    try {
      const created = await api.createCompany(name.trim(), newMission.trim());
      setActiveCompanyId(created.id);
      setName("");
      setNewMission("");
      await refreshCompanies();
    } finally {
      setBusy(false);
    }
  }

  async function saveMission() {
    if (!activeCompanyId || !missionEdit.trim()) return;
    setSavingMission(true);
    try {
      await api.updateMission(activeCompanyId, missionEdit.trim());
      await refreshCompanies();
    } finally {
      setSavingMission(false);
    }
  }

  async function archiveActiveCompany() {
    if (!activeCompanyId) return;
    const name = companies.find((c) => c.id === activeCompanyId)?.name ?? "this company";
    if (!confirm(`Archive "${name}"? Agents stop scheduling; data stays on disk.`)) return;
    await api.archiveCompany(activeCompanyId);
    const remaining = companies.filter((c) => c.id !== activeCompanyId && !c.archived);
    setActiveCompanyId(remaining[0]?.id ?? null);
    await refreshCompanies();
  }

  if (!activeCompanyId) {
    return (
      <div className="panel">
        <h2>New company</h2>
        <p className="muted">Create your first agent company to get started.</p>
        <div className="row" style={{ marginTop: "1rem" }}>
          <input placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Mission statement" value={newMission} onChange={(e) => setNewMission(e.target.value)} />
          <button type="button" disabled={busy} onClick={createCompany}>
            Create
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h2>Mission</h2>
        <textarea
          rows={3}
          style={{ width: "100%" }}
          value={missionEdit}
          onChange={(e) => setMissionEdit(e.target.value)}
        />
        <div className="row" style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
          <button
            type="button"
            className="secondary"
            disabled={savingMission}
            onClick={() => saveMission().catch(alert)}
          >
            Save mission
          </button>
          <button type="button" className="secondary" onClick={() => archiveActiveCompany().catch(alert)}>
            Archive company
          </button>
        </div>
      </div>
      {stats && (
        <div className="row" style={{ marginTop: "1rem" }}>
          <Stat label="Active agents" value={stats.agents_active} />
          <Stat label="Budget stopped" value={stats.agents_paused_budget} warn={stats.agents_paused_budget > 0} />
          <Stat label="Budget warn" value={stats.agents_budget_warn} warn={stats.agents_budget_warn > 0} />
          <Stat label="Pending approvals" value={stats.pending_approvals} warn={stats.pending_approvals > 0} />
          <Stat label="Open tickets" value={stats.open_tickets} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="panel" style={{ minWidth: 140 }}>
      <div className="muted">{label}</div>
      <div style={{ fontSize: "1.5rem", color: warn ? "#f87171" : undefined }}>{value}</div>
    </div>
  );
}
