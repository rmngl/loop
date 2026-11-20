import type { FC, ReactNode } from "react";

export type BadgeTone = "default" | "success" | "warn" | "danger" | "strategy" | "pending";

type Props = {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
};

export const Badge: FC<Props> = ({ children, tone = "default", className = "" }) => (
  <span className={`badge badge--${tone} ${className}`.trim()}>{children}</span>
);