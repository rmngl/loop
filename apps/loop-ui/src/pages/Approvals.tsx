import { useCallback, useEffect, useState } from "react";
import { api, type PendingApprovalRow } from "../api/loopd";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useCompany } from "../context/CompanyContext";

type Props = {
  onApprovalsChange?: () => void;
};

function kindTone(kind: string): "default" | "warn" | "strategy" {
  if (kind.includes("strategy")) return "strategy";
  if (kind.includes("budget") || kind.includes("hire") || kind.includes("agent")) return "warn";
  return "default";
}

export function ApprovalsPage({ onApprovalsChange }: Props) {
  const { activeCompanyId } = useCompany();
  const [rows, setRows] = useState<PendingApprovalRow[]>([]);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const data = await api.listPendingApprovals(activeCompanyId);
    setRows(data.approvals);
    onApprovalsChange?.();
  }, [activeCompanyId, onApprovalsChange]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function approve(id: string) {
    if (!activeCompanyId) return;
    await api.approve(activeCompanyId, id);
    await load();
  }

  if (!activeCompanyId) {
    return (
      <EmptyState title="Select a company" description="Choose a company in the sidebar to review the board queue." />
    );
  }

  return (
    <div>
      <PageHeader
        title="Board approvals"
        description="Pending hires, strategy tickets, and budget overrides await your sign-off before agents act."
        actions={rows.length > 0 ? <Badge tone="pending">{rows.length} pending</Badge> : undefined}
      />
      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No pending approvals — the board is clear.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Payload</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.approval_id}>
                  <td>
                    <Badge tone={kindTone(r.kind)}>{r.kind}</Badge>
                  </td>
                  <td>
                    <code>{JSON.stringify(r.payload)}</code>
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
        )}
      </div>
    </div>
  );
}