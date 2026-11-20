import { useCallback, useEffect, useState } from "react";
import { api, type AuditRow } from "../api/loopd";
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

  if (!activeCompanyId) return <p className="muted">Select a company.</p>;

  return (
    <div>
      <h2>Audit log</h2>
      <table className="panel" style={{ marginTop: "1rem" }}>
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
                <code style={{ fontSize: "0.75rem" }}>{JSON.stringify(e.payload)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}