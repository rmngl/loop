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
  if (kind === "tool_use") return "warn";
  if (kind.includes("budget") || kind.includes("hire") || kind.includes("agent")) return "warn";
  return "default";
}

function formatPayload(kind: string, payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return JSON.stringify(payload);
  }
  const p = payload as Record<string, unknown>;
  if (kind === "tool_use" && typeof p.tool === "string") {
    const pattern = typeof p.matched_pattern === "string" ? ` (${p.matched_pattern})` : "";
    const agent = typeof p.agent_id === "string" ? ` · agent ${p.agent_id.slice(0, 8)}…` : "";
    return `${p.tool}${pattern}${agent}`;
  }
  if (kind === "increase_company_budget" && typeof p.new_cap_usd === "number") {
    return `company monthly cap → $${p.new_cap_usd}`;
  }
  if (kind === "increase_budget" && typeof p.new_cap_usd === "number") {
    const agent = typeof p.agent_id === "string" ? ` · agent ${p.agent_id.slice(0, 8)}…` : "";
    return `agent cap → $${p.new_cap_usd}${agent}`;
  }
  return JSON.stringify(payload);
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
        description="Pending hires, strategy tickets, budget overrides, and one-shot tool use requests await board sign-off."
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
                    <code>{formatPayload(r.kind, r.payload)}</code>
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