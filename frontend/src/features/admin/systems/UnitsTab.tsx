import { useEffect, useId, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  ActionButton,
  DataTable,
  DetailsPanel,
  Field,
  InlineConfirm,
  PanelSection,
  SearchBox,
  formatAgo,
  useNavigationGuard,
  type Column,
} from "@/features/admin/_shell";
import type { AdminUnit, AdminUnitInput } from "@/types";
import { matchesUnit, unitTitle } from "./systems";

export interface UnitsTabProps {
  systemRowId: number;
  units: AdminUnit[];
  loading: boolean;
  openId: number | null;
  onOpen: (u: AdminUnit, trigger: HTMLElement) => void;
  onAdd: () => void;
}

/** The units table: number, label and when each was last heard. */
export default function UnitsTab({ systemRowId, units, loading, openId, onOpen, onAdd }: UnitsTabProps) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => units.filter((u) => matchesUnit(u, query)), [units, query]);

  const columns: Column<AdminUnit>[] = [
    { id: "unit", header: "Unit", phone: "title", sortValue: (u) => u.unitId, cell: (u) => <span className="font-mono">{u.unitId}</span> },
    {
      id: "label",
      header: "Label",
      phone: "show",
      sortValue: (u) => u.label ?? "",
      cell: (u) => u.label ?? <span className="italic text-admin-dim2">unlabeled</span>,
    },
    {
      id: "last",
      header: "Last heard",
      phone: "show",
      sortValue: (u) => u.lastHeard ?? 0,
      cell: (u) => (u.lastHeard ? formatAgo(u.lastHeard) : <span className="text-admin-dim2">never</span>),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} label="Search units" className="w-full sm:w-64" />
        <button type="button" className="btn btn-sm btn-primary ms-auto" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add unit
        </button>
      </div>
      <DataTable
        key={systemRowId}
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        caption="Units"
        loading={loading}
        defaultSort={{ id: "unit", dir: "asc" }}
        pageSize={50}
        onOpen={onOpen}
        openKey={openId}
        rowLabel={unitTitle}
        empty={units.length === 0 ? "No units yet. Add one to name a radio." : "No units match."}
      />
    </div>
  );
}

export interface UnitFormProps {
  systemId: number;
  /** null creates a unit. */
  unit: AdminUnit | null;
  busy: boolean;
  error: string | null;
  onSubmit: (values: AdminUnitInput) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Add or edit a unit's number and label. */
export function UnitForm({ systemId, unit, busy, error, onSubmit, onDelete, onClose }: UnitFormProps) {
  const id = useId();
  const [unitId, setUnitId] = useState(unit ? String(unit.unitId) : "");
  const [label, setLabel] = useState(unit?.label ?? "");
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { setGuard } = useNavigationGuard();
  const formId = `${id}-form`;

  useEffect(() => {
    setGuard(dirty ? () => true : null);
    return () => setGuard(null);
  }, [dirty, setGuard]);

  return (
    <DetailsPanel
      title={unit ? `Edit ${unitTitle(unit)}` : "Add unit"}
      subtitle={unit?.lastHeard ? `Last heard ${formatAgo(unit.lastHeard)}` : undefined}
      onClose={onClose}
      footer={
        confirming ? null : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy || unitId === ""}>
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setDirty(false);
          onSubmit({ systemId, unitId: Number(unitId), label: label.trim() || null, order: unit?.order ?? 0 });
        }}
      >
        {error && (
          <p role="alert" className="alert alert-error text-sm">
            {error}
          </p>
        )}
        <Field htmlFor={`${id}-unit`} label="Unit number" hint="The radio ID your recorder sends.">
          <input
            id={`${id}-unit`}
            type="number"
            min={0}
            inputMode="numeric"
            className="input w-full"
            value={unitId}
            required
            onChange={(e) => {
              setUnitId(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <Field htmlFor={`${id}-label`} label="Label" hint="Shown instead of the number.">
          <input
            id={`${id}-label`}
            type="text"
            className="input w-full"
            maxLength={64}
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
      </form>
      {unit && (
        <PanelSection title="Danger">
          {confirming ? (
            <InlineConfirm
              title={`Delete ${unitTitle(unit)}?`}
              text="Calls from this radio keep the number only."
              button="Delete"
              danger
              busy={busy}
              onCancel={() => setConfirming(false)}
              onConfirm={onDelete}
            />
          ) : (
            <ActionButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete unit"
              hint="Calls keep the number."
              danger
              disabled={busy}
              onClick={() => setConfirming(true)}
            />
          )}
        </PanelSection>
      )}
    </DetailsPanel>
  );
}
