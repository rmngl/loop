import type { FC, ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export const PageHeader: FC<Props> = ({ title, description, actions }) => (
  <header className="page-header">
    <div className="page-header__text">
      <h2 className="page-header__title">{title}</h2>
      {description && <p className="page-header__desc">{description}</p>}
    </div>
    {actions && <div className="page-header__actions">{actions}</div>}
  </header>
);