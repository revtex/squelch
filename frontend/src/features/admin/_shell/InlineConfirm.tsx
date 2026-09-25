import type { ReactNode } from "react";

export interface InlineConfirmProps {
  /** The question, e.g. "Delete alice?". */
  title: string;
  /** What will happen, and what will be lost. */
  text: ReactNode;
  /** The confirming button's label, a verb. */
  button: string;
  /** The action cannot be undone. */
  danger?: boolean;
  busy?: boolean;
  /** Extra controls, e.g. a typed confirmation, shown above the buttons. */
  children?: ReactNode;
  /** The confirm button stays off until this is true. */
  ready?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * A confirmation that stays where the action was asked for, instead of a
 * browser prompt: it names the thing, says what will be lost, and offers the
 * verb. Hosts show it in place of the action list.
 */
export function InlineConfirm({
  title,
  text,
  button,
  danger = false,
  busy = false,
  children,
  ready = true,
  onCancel,
  onConfirm,
}: InlineConfirmProps) {
  return (
    <div
      role="group"
      aria-label="Confirm"
      className="space-y-3 rounded-box border border-base-300 bg-base-200 p-4"
    >
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-base-content/70">{text}</p>
      {children}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`btn btn-sm ${danger ? "btn-error" : "btn-primary"}`}
          onClick={onConfirm}
          disabled={busy || !ready}
        >
          {busy && <span className="loading loading-spinner loading-xs" />}
          {button}
        </button>
      </div>
    </div>
  );
}
