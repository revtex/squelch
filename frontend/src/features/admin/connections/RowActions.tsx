import { MoreHorizontal } from "lucide-react";

export interface RowAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/** A row's action menu. Renders nothing when the row has no actions. */
export default function RowActions({
  label,
  actions,
}: {
  /** Names the row, e.g. "Actions for alice". */
  label: string;
  actions: RowAction[];
}) {
  if (actions.length === 0) return null;
  return (
    <div className="dropdown dropdown-end">
      <div
        tabIndex={0}
        role="button"
        aria-label={label}
        className="btn btn-ghost btn-xs"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </div>
      <ul
        tabIndex={0}
        className="dropdown-content menu z-10 w-52 rounded-box bg-base-200 p-2 shadow"
      >
        {actions.map((a) => (
          <li key={a.label}>
            <button
              type="button"
              className={a.danger ? "text-error" : undefined}
              onClick={(e) => {
                // Close the menu: DaisyUI keeps it open while focus is inside.
                e.currentTarget.blur();
                a.onSelect();
              }}
            >
              {a.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
