import type { FC } from "react";

type Props = {
  companies: { id: string; name: string; archived?: boolean }[];
  activeId: string | null;
  onChange: (id: string) => void;
};

export const CompanySwitcher: FC<Props> = ({ companies, activeId, onChange }) => {
  const selectable = companies.filter((c) => !c.archived);
  const active = companies.find((c) => c.id === activeId);
  const value = active && !active.archived ? activeId ?? "" : selectable[0]?.id ?? "";

  return (
    <select
      className="company-switcher"
      aria-label="Company switcher"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        Select company
      </option>
      {selectable.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
};