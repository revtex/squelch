import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  /** What this page is for, in a sentence. */
  subtitle?: ReactNode;
  /** Buttons at the right; the primary "Add" button goes last. */
  actions?: ReactNode;
}

/** Every admin page starts with this: a title, a line of help, and its actions. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-bold">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-sm text-base-content/60">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
