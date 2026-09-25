import type { ReactNode } from "react";

export type NoticeTone = "info" | "ok" | "warn" | "bad";

const TONE: Record<NoticeTone, string> = {
  info: "",
  ok: "alert-success",
  warn: "alert-warning",
  bad: "alert-error",
};

export interface NoticeProps {
  tone?: NoticeTone;
  icon?: ReactNode;
  /** A button or link at the right end. */
  action?: ReactNode;
  children: ReactNode;
  /** "status" or "alert" when the notice reports something that changed. */
  role?: "status" | "alert";
  className?: string;
}

/** A tinted line of news: navy info, green ok, amber warn, red bad. */
export function Notice({
  tone = "info",
  icon,
  action,
  children,
  role,
  className = "",
}: NoticeProps) {
  return (
    <div role={role} className={`alert flex items-start ${TONE[tone]} ${className}`}>
      {icon && (
        <span className="mt-px shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="ml-auto shrink-0 self-center">{action}</div>}
    </div>
  );
}
