import type { FC } from "react";

type Props = {
  label: string;
  value: number;
  warn?: boolean;
  accent?: boolean;
};

export const KpiTile: FC<Props> = ({ label, value, warn, accent }) => (
  <div
    className={`kpi-tile panel ${warn ? "kpi-tile--warn" : ""} ${accent ? "kpi-tile--accent" : ""}`.trim()}
  >
    <span className="kpi-tile__label">{label}</span>
    <span className="kpi-tile__value tabular-nums">{value}</span>
  </div>
);