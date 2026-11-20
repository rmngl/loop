export const DEFAULT_BASE = "http://127.0.0.1:7841";

export type CompanyRow = {
  id: string;
  name: string;
  mission: string;
  monthly_budget_usd?: number | null;
  archived?: boolean;
  archived_at?: string | null;
};

export function companyPath(base: string, companyId: string, path: string): string {
  return `${base}/v1/companies/${companyId}${path}`;
}

export function withCompanyBase(base: string, companyId: string | null): string {
  return companyId ? `${base}/v1/companies/${companyId}` : base;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  base: DEFAULT_BASE,

  async listCompanies(): Promise<CompanyRow[]> {
    const res = await fetch(`${DEFAULT_BASE}/v1/companies`);
    return json<CompanyRow[]>(res);
  },

  async createCompany(name: string, mission: string): Promise<CompanyRow> {
    const res = await fetch(`${DEFAULT_BASE}/v1/companies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mission }),
    });
    return json(res);
  },

  async archiveCompany(companyId: string) {
    const res = await fetch(`${DEFAULT_BASE}/v1/companies/${companyId}`, { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
  },

  async listPendingApprovals(companyId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/approvals"));
    return json<{ approvals: PendingApprovalRow[] }>(res);
  },

  async hireAgent(
    companyId: string,
    body: {
      title: string;
      adapter_kind: string;
      cron: string;
      monthly_budget_usd: number;
      adapter_config?: Record<string, unknown>;
      parent_agent_id?: string | null;
    }
  ) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/agents"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return json<{ agent_id: string; approval_id: string }>(res);
  },

  async approve(companyId: string, approvalId: string) {
    const res = await fetch(
      `${DEFAULT_BASE}/v1/companies/${companyId}/approvals/${approvalId}/approve`,
      { method: "POST" }
    );
    if (!res.ok) throw new Error(await res.text());
  },

  async listAgents(companyId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/agents"));
    return json<{ agents: AgentRow[] }>(res);
  },

  async listTickets(companyId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/tickets"));
    return json<{ tickets: TicketRow[] }>(res);
  },

  async createTicket(
    companyId: string,
    title: string,
    description: string,
    tags: string[] = [],
    projectId?: string
  ) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/tickets"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, tags, project_id: projectId }),
    });
    return json<{ ticket_id: string; strategy_approval_id?: string }>(res);
  },

  async submitTicketReview(companyId: string, ticketId: string) {
    const res = await fetch(
      companyPath(DEFAULT_BASE, companyId, `/tickets/${ticketId}/submit-review`),
      { method: "POST" }
    );
    if (!res.ok) throw new Error(await res.text());
  },

  async approveTicketDone(companyId: string, ticketId: string) {
    const res = await fetch(
      companyPath(DEFAULT_BASE, companyId, `/tickets/${ticketId}/approve-done`),
      { method: "POST" }
    );
    if (!res.ok) throw new Error(await res.text());
  },

  async requestTicketChanges(companyId: string, ticketId: string) {
    const res = await fetch(
      companyPath(DEFAULT_BASE, companyId, `/tickets/${ticketId}/request-changes`),
      { method: "POST" }
    );
    if (!res.ok) throw new Error(await res.text());
  },

  async assignTicket(
    companyId: string,
    ticketId: string,
    agentId: string,
    reviewerAgentId?: string | null
  ) {
    const res = await fetch(
      companyPath(DEFAULT_BASE, companyId, `/tickets/${ticketId}/assign`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          reviewer_agent_id: reviewerAgentId ?? undefined,
        }),
      }
    );
    if (!res.ok) throw new Error(await res.text());
  },

  async setTicketReviewer(companyId: string, ticketId: string, agentId: string | null) {
    const body = agentId ? { agent_id: agentId } : { clear: true };
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, `/tickets/${ticketId}/reviewer`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return json<{ ticket_id: string; reviewer_agent_id: string | null }>(res);
  },

  async getTicket(companyId: string, ticketId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, `/tickets/${ticketId}`));
    return json<{ ticket: TicketDetail; messages: TicketMessageRow[]; traces: unknown[] }>(res);
  },

  async postTicketMessage(companyId: string, ticketId: string, author: string, body: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, `/tickets/${ticketId}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author, body }),
    });
    if (!res.ok) throw new Error(await res.text());
  },

  async dashboard(companyId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/dashboard"));
    return json<DashboardStats>(res);
  },

  async listProjects(companyId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/projects"));
    return json<{ projects: ProjectRow[] }>(res);
  },

  async createProject(companyId: string, name: string, goal: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, goal }),
    });
    return json<ProjectRow>(res);
  },

  async updateMission(companyId: string, mission: string) {
    const res = await fetch(`${DEFAULT_BASE}/v1/companies/${companyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission }),
    });
    return json<CompanyRow>(res);
  },

  async updateCompanyMonthlyBudget(companyId: string, monthlyBudgetUsd: number | null) {
    const body =
      monthlyBudgetUsd === null
        ? { clear_monthly_budget: true }
        : { monthly_budget_usd: monthlyBudgetUsd };
    const res = await fetch(`${DEFAULT_BASE}/v1/companies/${companyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return json<CompanyRow>(res);
  },

  async requestBudgetIncrease(companyId: string, agentId: string, newCapUsd: number) {
    const res = await fetch(
      companyPath(DEFAULT_BASE, companyId, `/agents/${agentId}/budget-increase`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_cap_usd: newCapUsd }),
      }
    );
    return json<{ approval_id: string }>(res);
  },

  async requestCompanyBudgetIncrease(companyId: string, newCapUsd: number) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/company-budget-increase"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_cap_usd: newCapUsd }),
    });
    return json<{ approval_id: string }>(res);
  },

  async listBudgets(companyId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/budgets"));
    return json<{ company: CompanyBudgetRollup | null; agents: BudgetRow[] }>(res);
  },

  async listAudit(companyId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/audit"));
    return json<{ entries: AuditRow[] }>(res);
  },

  async listToolPolicies(companyId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/tool-policies"));
    return json<{ policies: ToolPolicyRow[] }>(res);
  },

  async upsertToolPolicy(companyId: string, toolPattern: string, disposition: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/tool-policies"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_pattern: toolPattern, disposition }),
    });
    return json<ToolPolicyRow>(res);
  },

  async removeToolPolicy(companyId: string, toolPattern: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/tool-policies/remove"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_pattern: toolPattern }),
    });
    if (!res.ok) throw new Error(await res.text());
  },

  async evaluateTool(companyId: string, tool: string, agentId?: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/tools/evaluate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, agent_id: agentId }),
    });
    return json<ToolEvaluateResult>(res);
  },

  async requestToolUse(companyId: string, tool: string, agentId?: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/tools/request-use"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, agent_id: agentId }),
    });
    return json<ToolUseRequestResult>(res);
  },

  async consumeToolGrant(companyId: string, grantId: string) {
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/tools/consume"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_id: grantId }),
    });
    if (!res.ok) throw new Error(await res.text());
  },

  async invokeTool(companyId: string, tool: string, agentId?: string, input?: unknown) {
    const body: Record<string, unknown> = { tool };
    if (agentId) body.agent_id = agentId;
    if (input !== undefined) body.input = input;
    const res = await fetch(companyPath(DEFAULT_BASE, companyId, "/tools/invoke"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return json<ToolInvokeResult>(res);
  },

  async triggerHeartbeat(companyId: string, agentId: string) {
    const res = await fetch(
      companyPath(DEFAULT_BASE, companyId, `/agents/${agentId}/heartbeat`),
      { method: "POST" }
    );
    return json(res);
  },
};

export type AgentRow = {
  agent_id: string;
  title: string;
  adapter_kind: string;
  status: string;
  cron: string;
  monthly_budget_usd: number;
  parent_agent_id?: string | null;
  paused_reason: string | null;
};

export type TicketRow = {
  ticket_id: string;
  title: string;
  status: string;
  assignee_agent_id: string | null;
  reviewer_agent_id?: string | null;
  tags: string[];
};

export type TicketDetail = TicketRow & { description: string; project_id?: string | null };

export type TicketMessageRow = { author: string; body: string; created_at: string };

export type ProjectRow = { project_id: string; name: string; goal: string };

export type DashboardStats = {
  agents_active: number;
  agents_paused_budget: number;
  agents_budget_warn: number;
  pending_approvals: number;
  open_tickets: number;
  tickets_in_review?: number;
  company_budget?: CompanyBudgetRollup | null;
};

export type CompanyBudgetRollup = {
  cap_usd: number;
  used_usd: number;
  remaining_usd: number;
  warn: boolean;
  exhausted: boolean;
};

export type BudgetRow = {
  agent_id: string;
  title: string;
  remaining_usd: number;
  cap_usd: number;
  paused_reason: string | null;
};

export type AuditRow = {
  id: number;
  kind: string;
  payload: unknown;
};

export type PendingApprovalRow = {
  approval_id: string;
  kind: string;
  payload: unknown;
  created_at: string;
};

export type ToolPolicyRow = {
  tool_pattern: string;
  disposition: string;
};

export type ToolEvaluateResult = {
  disposition: string;
  matched_pattern: string | null;
  allowed: boolean;
  grant_id?: string | null;
  pending_approval_id?: string | null;
};

export type ToolUseRequestResult = {
  status: "allowed" | "already_granted" | "pending";
  allowed?: boolean;
  disposition?: string;
  matched_pattern?: string | null;
  grant_id?: string;
  approval_id?: string;
};

export type ToolInvokeResult = {
  status: string;
  tool: string;
  disposition: string;
  grant_consumed: boolean;
  result: unknown;
};

export async function listCompanies(base = DEFAULT_BASE) {
  const res = await fetch(`${base}/v1/companies`);
  return res.json();
}