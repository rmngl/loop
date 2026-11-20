import { useCallback, useEffect, useState } from "react";
import { api, type AuditRow } from "../api/loopd";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useCompany } from "../context/CompanyContext";

export function AuditPage() {
  const { activeCompanyId } = useCompany();
  const [entries, setEntries] = useState<AuditRow[]>([]);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const data = await api.listAudit(activeCompanyId);
    setEntries(data.entries);
  }, [activeCompanyId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  if (!activeCompanyId) {
    return <EmptyState title="Select a company" description="Append-only governance and system events per company." />;
  }

  return (
    <div>
      <PageHeader title="Audit log" description="Append-only record of hires, approvals, heartbeats, and system actions." />
      <div className="panel">
        <table className="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Kind</th>
            <th>Payload</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td>{e.kind}</td>
              <td>
                <code>{JSON.stringify(e.payload)}</code>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}