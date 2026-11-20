import { useState } from "react";
import { CompanySwitcher } from "./components/CompanySwitcher";
import { useCompany } from "./context/CompanyContext";
import { AuditPage } from "./pages/Audit";
import { BudgetsPage } from "./pages/Budgets";
import { HomePage } from "./pages/Home";
import { OrgPage } from "./pages/Org";
import { ApprovalsPage } from "./pages/Approvals";
import { ProjectsPage } from "./pages/Projects";
import { TicketsPage } from "./pages/Tickets";

type Tab = "home" | "projects" | "org" | "tickets" | "budgets" | "approvals" | "audit";

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const { companies, activeCompanyId, setActiveCompanyId } = useCompany();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Loop</h1>
        <CompanySwitcher
          companies={companies}
          activeId={activeCompanyId}
          onChange={setActiveCompanyId}
        />
        <nav className="nav" style={{ marginTop: "1rem" }}>
          {(
            [
              ["home", "Mission"],
              ["projects", "Projects"],
              ["org", "Org chart"],
              ["tickets", "Tickets"],
              ["budgets", "Budgets"],
              ["approvals", "Approvals"],
              ["audit", "Audit"],
            ] as const
          ).map(([key, label]) => (
            <a
              key={key}
              href="#"
              className={tab === key ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                setTab(key);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="main">
        {tab === "home" && <HomePage />}
        {tab === "projects" && <ProjectsPage />}
        {tab === "org" && <OrgPage />}
        {tab === "tickets" && <TicketsPage />}
        {tab === "budgets" && <BudgetsPage />}
        {tab === "approvals" && <ApprovalsPage />}
        {tab === "audit" && <AuditPage />}
      </main>
    </div>
  );
}