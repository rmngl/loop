import { useCallback, useEffect, useState } from "react";
import { api, type ProjectRow } from "../api/loopd";
import { useCompany } from "../context/CompanyContext";

export function ProjectsPage() {
  const { activeCompanyId } = useCompany();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const data = await api.listProjects(activeCompanyId);
    setProjects(data.projects);
  }, [activeCompanyId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function create() {
    if (!activeCompanyId || !name.trim()) return;
    await api.createProject(activeCompanyId, name.trim(), goal.trim());
    setName("");
    setGoal("");
    await load();
  }

  if (!activeCompanyId) return <p className="muted">Select a company.</p>;

  return (
    <div>
      <h2>Projects</h2>
      <p className="muted">Initiatives under the company mission. Tickets can link to a project for alignment.</p>
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        <input
          placeholder="Project goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          style={{ width: "100%", marginTop: "0.5rem" }}
        />
        <button type="button" style={{ marginTop: "0.5rem" }} onClick={() => create().catch(alert)}>
          Create project
        </button>
      </div>
      <ul className="panel">
        {projects.map((p) => (
          <li key={p.project_id} style={{ marginBottom: "0.75rem" }}>
            <strong>{p.name}</strong>
            <div className="muted">{p.goal}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}