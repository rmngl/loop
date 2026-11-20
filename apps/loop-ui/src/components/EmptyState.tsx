import type { FC, ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export const EmptyState: FC<Props> = ({ title, description, children }) => (
  <div className="empty-state panel panel--hero">
    <h3 className="empty-state__title">{title}</h3>
    {description && <p className="muted empty-state__desc">{description}</p>}
    {children && <div className="empty-state__body">{children}</div>}
  </div>
);