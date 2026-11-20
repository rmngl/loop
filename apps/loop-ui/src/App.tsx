import { useCallback, useEffect, useState } from "react";
import { CompanySwitcher } from "./components/CompanySwitcher";
import { useCompany } from "./context/CompanyContext";
import { api } from "./api/loopd";
import { AuditPage } from "./pages/Audit";
import { BudgetsPage } from "./pages/Budgets";
import { HomePage } from "./pages/Home";
import { OrgPage } from "./pages/Org";
import { ApprovalsPage } from "./pages/Approvals";
import { ProjectsPage } from "./pages/Projects";
import { TicketsPage } from "./pages/Tickets";
import { ToolsPage } from "./pages/Tools";

type Tab = "home" | "projects" | "org" | "tickets" | "budgets" | "approvals" | "audit" | "tools";

const NAV: {
  group: string;
  items: { key: Tab; label: string; badgeKey?: "approvals" | "tickets_review" }[];
}[] = [
  {
    group: "Mission",
    items: [{ key: "home", label: "Dashboard" }],
  },
  {
    group: "Work",
    items: [
      { key: "projects", label: "Projects" },
      { key: "org", label: "Org chart" },
      { key: "tickets", label: "Tickets", badgeKey: "tickets_review" },
    ],
  },
  {
    group: "Governance",
    items: [
      { key: "budgets", label: "Budgets" },
      { key: "tools", label: "Tool gateway" },
      { key: "approvals", label: "Approvals", badgeKey: "approvals" },
      { key: "audit", label: "Audit" },
    ],
  },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const { companies, activeCompanyId, setActiveCompanyId } = useCompany();
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [ticketsInReview, setTicketsInReview] = useState(0);

  const refreshPending = useCallback(async () => {
    if (!activeCompanyId) {
      setPendingApprovals(0);
      setTicketsInReview(0);
      return;
    }
    try {
      const stats = await api.dashboard(activeCompanyId);
      setPendingApprovals(stats.pending_approvals);
      setTicketsInReview(stats.tickets_in_review ?? 0);
    } catch {
      setPendingApprovals(0);
      setTicketsInReview(0);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    refreshPending().catch(console.error);
    const t = setInterval(() => refreshPending().catch(console.error), 30_000);
    return () => clearInterval(t);
  }, [refreshPending]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <h1 className="sidebar__logo">Loop</h1>
          <p className="sidebar__tagline">Agent company OS</p>
          <CompanySwitcher
            companies={companies}
            activeId={activeCompanyId}
            onChange={setActiveCompanyId}
          />
        </div>
        {NAV.map((section) => (
          <nav key={section.group} className="nav nav-group" aria-label={section.group}>
            <span className="nav-group__label">{section.group}</span>
            {section.items.map(({ key, label, badgeKey }) => (
              <a
                key={key}
                href="#"
                className={tab === key ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  setTab(key);
                }}
              >
                <span>{label}</span>
                {badgeKey === "approvals" && pendingApprovals > 0 && (
                  <span className="badge badge--pending nav-badge">{pendingApprovals}</span>
                )}
                {badgeKey === "tickets_review" && ticketsInReview > 0 && (
                  <span className="badge badge--warn nav-badge">{ticketsInReview}</span>
                )}
              </a>
            ))}
          </nav>
        ))}
      </aside>
      <main className="main">
        {tab === "home" && <HomePage onStatsChange={() => refreshPending().catch(console.error)} />}
        {tab === "projects" && <ProjectsPage />}
        {tab === "org" && <OrgPage />}
        {tab === "tickets" && (
          <TicketsPage onWorkflowChange={() => refreshPending().catch(console.error)} />
        )}
        {tab === "budgets" && <BudgetsPage />}
        {tab === "tools" && <ToolsPage />}
        {tab === "approvals" && (
          <ApprovalsPage onApprovalsChange={() => refreshPending().catch(console.error)} />
        )}
        {tab === "audit" && <AuditPage />}
      </main>
    </div>
  );
}