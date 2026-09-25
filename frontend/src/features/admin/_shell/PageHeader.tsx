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
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-[-0.01em] md:text-[22px]">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 max-w-[62ch] text-base-content-dim">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="admin-acts flex flex-wrap items-center justify-end gap-2 max-md:w-full max-md:justify-start max-md:[&>.btn]:flex-auto max-md:[&>.btn]:justify-center">
          {actions}
        </div>
      )}
    </div>
  );
}
