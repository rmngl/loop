import { useCallback, useEffect, useState } from "react";
import { api, type PendingApprovalRow } from "../api/loopd";
import { useCompany } from "../context/CompanyContext";

export function ApprovalsPage() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows] = useState<PendingApprovalRow[]>([]);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const data = await api.listPendingApprovals(activeCompanyId);
    setRows(data.approvals);
  }, [activeCompanyId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function approve(id: string) {
    if (!activeCompanyId) return;
    await api.approve(activeCompanyId, id);
    await load();
  }

  if (!activeCompanyId) return <p className="muted">Select a company.</p>;

  return (
    <div>
      <h2>Board approvals</h2>
      <p className="muted">Pending hires, strategy tickets, and budget overrides appear here.</p>
      <table className="panel" style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Payload</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No pending approvals
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.approval_id}>
              <td>{r.kind}</td>
              <td>
                <code style={{ fontSize: "0.75rem" }}>{JSON.stringify(r.payload)}</code>
              </td>
              <td>
                <button type="button" onClick={() => approve(r.approval_id).catch(alert)}>
                  Approve
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}