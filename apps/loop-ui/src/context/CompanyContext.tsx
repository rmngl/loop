import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { api, type CompanyRow } from "../api/loopd";

type CompanyContextValue = {
  companies: CompanyRow[];
  activeCompanyId: string | null;
  setActiveCompanyId: (id: string) => void;
  refreshCompanies: () => Promise<void>;
  mission: string | null;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);

  const refreshCompanies = useCallback(async () => {
    const list = await api.listCompanies();
    setCompanies(list);

    const activeList = list.filter((c) => !c.archived);
    if (activeCompanyId) {
      const current = list.find((c) => c.id === activeCompanyId);
      if (current?.archived) {
        const next = activeList[0]?.id ?? null;
        setActiveCompanyId(next);
      }
    } else if (activeList.length > 0) {
      setActiveCompanyId(activeList[0].id);
    }
  }, [activeCompanyId]);

  React.useEffect(() => {
    refreshCompanies().catch(console.error);
  }, [refreshCompanies]);

  const mission = useMemo(() => {
    if (!activeCompanyId) return null;
    return companies.find((c) => c.id === activeCompanyId)?.mission ?? null;
  }, [companies, activeCompanyId]);

  const value: CompanyContextValue = {
    companies,
    activeCompanyId,
    setActiveCompanyId,
    refreshCompanies,
    mission,
  };

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany outside provider");
  return ctx;
}