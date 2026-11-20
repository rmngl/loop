import { useCallback, useEffect, useState } from "react";
import { api, type DashboardStats } from "../api/loopd";
import { EmptyState } from "../components/EmptyState";
import { KpiTile } from "../components/KpiTile";
import { PageHeader } from "../components/PageHeader";
import { useCompany } from "../context/CompanyContext";

type Props = {
  onStatsChange?: () => void;
};

export function HomePage({ onStatsChange }: Props) {
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
    onStatsChange?.();
  }, [activeCompanyId, onStatsChange]);

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
    const companyName = companies.find((c) => c.id === activeCompanyId)?.name ?? "this company";
    if (!confirm(`Archive "${companyName}"? Agents stop scheduling; data stays on disk.`)) return;
    await api.archiveCompany(activeCompanyId);
    const remaining = companies.filter((c) => c.id !== activeCompanyId && !c.archived);
    setActiveCompanyId(remaining[0]?.id ?? null);
    await refreshCompanies();
  }

  if (!activeCompanyId) {
    return (
      <>
        <PageHeader
          title="Welcome"
          description="Spin up your first agent company — mission, org, tickets, and board approvals on your machine."
        />
        <EmptyState title="No company yet" description="Name the company and state its mission. You can hire agents after board setup.">
          <div className="row">
            <input placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="Mission statement" value={newMission} onChange={(e) => setNewMission(e.target.value)} />
            <button type="button" disabled={busy} onClick={createCompany}>
              Create company
            </button>
          </div>
        </EmptyState>
      </>
    );
  }

  const activeName = companies.find((c) => c.id === activeCompanyId)?.name;

  return (
    <div>
      <PageHeader
        title={activeName ?? "Dashboard"}
        description="Mission at a glance — agents, budget posture, governance queue, and open work."
      />
      <div className="panel panel--hero mission-hero">
        <div className="mission-hero__label">Company mission</div>
        <textarea
          rows={4}
          style={{ width: "100%" }}
          value={missionEdit}
          onChange={(e) => setMissionEdit(e.target.value)}
        />
        <div className="row" style={{ marginTop: "0.85rem", gap: "0.5rem" }}>
          <button type="button" disabled={savingMission} onClick={() => saveMission().catch(alert)}>
            Save mission
          </button>
          <button type="button" className="secondary" onClick={() => archiveActiveCompany().catch(alert)}>
            Archive company
          </button>
        </div>
      </div>
      {stats && (
        <div className="kpi-grid">
          <KpiTile label="Active agents" value={stats.agents_active} accent />
          <KpiTile label="Budget stopped" value={stats.agents_paused_budget} warn={stats.agents_paused_budget > 0} />
          <KpiTile label="Budget warn" value={stats.agents_budget_warn} warn={stats.agents_budget_warn > 0} />
          <KpiTile label="Pending approvals" value={stats.pending_approvals} warn={stats.pending_approvals > 0} />
          <KpiTile label="Open tickets" value={stats.open_tickets} />
          <KpiTile
            label="Awaiting review"
            value={stats.tickets_in_review ?? 0}
            warn={(stats.tickets_in_review ?? 0) > 0}
          />
        </div>
      )}
    </div>
  );
}