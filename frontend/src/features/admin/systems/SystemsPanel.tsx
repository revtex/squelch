import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpDown, ChevronLeft, Download, Plus, Settings2, Upload } from "lucide-react";
import {
  PageHeader,
  formatAgo,
  plural,
  useBlockTalkgroupMutation,
  useBulkTalkgroupsMutation,
  useCreateSystemMutation,
  useCreateTalkgroupMutation,
  useCreateUnitMutation,
  useDeleteSystemMutation,
  useDeleteTalkgroupMutation,
  useDeleteTalkgroupsMutation,
  useDeleteUnitMutation,
  useDetails,
  useLazyExportTalkgroupsQuery,
  useListGroupsQuery,
  useListSystemsQuery,
  useListTagsQuery,
  useListTalkgroupsQuery,
  useListUnitsQuery,
  useReorderSystemsMutation,
  useToast,
  useUnblockTalkgroupMutation,
  useUpdateSystemMutation,
  useUpdateTalkgroupMutation,
  useUpdateUnitMutation,
} from "@/features/admin/_shell";
import type { AdminSystemInput, AdminTalkgroup, AdminTalkgroupInput, AdminUnit, AdminUnitInput } from "@/types";
import BlockedTab from "./BlockedTab";
import ImportWizard from "./ImportWizard";
import SystemForm from "./SystemForm";
import SystemList from "./SystemList";
import TalkgroupDetails from "./TalkgroupDetails";
import TalkgroupForm from "./TalkgroupForm";
import TalkgroupsTab, { type BulkChange } from "./TalkgroupsTab";
import UnitsTab, { UnitForm } from "./UnitsTab";
import { systemsInOrder, tabFrom, type Tab } from "./systems";

type Panel =
  | { kind: "system-create" }
  | { kind: "system-edit" }
  | { kind: "import" }
  | { kind: "talkgroup"; id: number }
  | { kind: "talkgroup-create" }
  | { kind: "unit"; id: number }
  | { kind: "unit-create" };

const TABS: { id: Tab; label: string }[] = [
  { id: "talkgroups", label: "Talkgroups" },
  { id: "units", label: "Units" },
  { id: "blocked", label: "Blocked" },
];

const desktopQuery = "(min-width: 768px)";
function subscribeDesktop(cb: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(desktopQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function isDesktop() {
  return typeof window.matchMedia !== "function" || window.matchMedia(desktopQuery).matches;
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function numberParam(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Systems on the left, the chosen one's talkgroups, units and blocked list on the right. */
export default function SystemsPanel() {
  const [search, setSearch] = useSearchParams();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => true);
  const toast = useToast();

  const { data: systemsData, isLoading: loadingSystems } = useListSystemsQuery();
  const { data: groups } = useListGroupsQuery();
  const { data: tags } = useListTagsQuery();
  const systems = useMemo(() => systemsInOrder(systemsData), [systemsData]);

  const paramId = numberParam(search.get("system"));
  const groupParam = numberParam(search.get("group"));
  const tagParam = numberParam(search.get("tag"));
  const tab = tabFrom(search.get("tab"));

  const [createSystem] = useCreateSystemMutation();
  const [updateSystem] = useUpdateSystemMutation();
  const [deleteSystem] = useDeleteSystemMutation();
  const [reorderSystems] = useReorderSystemsMutation();
  const [blockTalkgroup] = useBlockTalkgroupMutation();
  const [unblockTalkgroup] = useUnblockTalkgroupMutation();
  const [createTalkgroup] = useCreateTalkgroupMutation();
  const [updateTalkgroup] = useUpdateTalkgroupMutation();
  const [deleteTalkgroup] = useDeleteTalkgroupMutation();
  const [deleteTalkgroups] = useDeleteTalkgroupsMutation();
  const [bulkTalkgroups] = useBulkTalkgroupsMutation();
  const [createUnit] = useCreateUnitMutation();
  const [updateUnit] = useUpdateUnitMutation();
  const [deleteUnit] = useDeleteUnitMutation();
  const [exportTalkgroups] = useLazyExportTalkgroupsQuery();

  const [reordering, setReordering] = useState(false);
  const [order, setOrder] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const panel = useDetails<Panel>();
  const p = panel.selected;

  // A `?group=` / `?tag=` link from the Groups page lands on the first system
  // that uses it; otherwise the URL's system, or on desktop the first one.
  const talkgroupsForLink = useListTalkgroupsQuery(undefined, {
    skip: groupParam == null && tagParam == null,
  });
  const linkedSystem = useMemo(() => {
    if (groupParam == null && tagParam == null) return null;
    const hit = (talkgroupsForLink.data ?? []).find(
      (t) => (groupParam != null && t.groupId === groupParam) || (tagParam != null && t.tagId === tagParam),
    );
    return hit ? hit.systemId : null;
  }, [talkgroupsForLink.data, groupParam, tagParam]);

  const selectedId = paramId ?? linkedSystem ?? (desktop && systems.length > 0 ? systems[0].id : null);
  const system = systems.find((s) => s.id === selectedId) ?? null;

  const { data: talkgroupsData, isLoading: loadingTalkgroups } = useListTalkgroupsQuery(system?.id, { skip: !system });
  const { data: unitsData, isLoading: loadingUnits } = useListUnitsQuery(system?.id, { skip: !system });
  const talkgroups = useMemo(() => (system ? (talkgroupsData ?? []).filter((t) => t.systemId === system.id) : []), [talkgroupsData, system]);
  const units = useMemo(() => (system ? (unitsData ?? []).filter((u) => u.systemId === system.id) : []), [unitsData, system]);
  const blockedSet = useMemo(() => new Set(system?.blocked ?? []), [system]);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(search);
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) next.delete(k);
        else next.set(k, v);
      }
      setSearch(next, { replace: true });
    },
    [search, setSearch],
  );

  const selectSystem = (id: number | null) => {
    panel.reset();
    setFormError(null);
    setParams({ system: id == null ? null : String(id), group: null, tag: null, tab: null });
  };
  const selectTab = (next: Tab) => {
    panel.reset();
    setFormError(null);
    setParams({ tab: next === "talkgroups" ? null : next });
  };

  const run = async (work: () => Promise<void>, fallback: string): Promise<boolean> => {
    setBusy(true);
    setFormError(null);
    try {
      await work();
      return true;
    } catch (e) {
      const msg = messageOf(e, fallback);
      setFormError(msg);
      toast.error(msg);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ── systems ──
  const saveSystem = async (values: AdminSystemInput) => {
    if (p?.kind === "system-create") {
      const ok = await run(async () => {
        const created = await createSystem(values).unwrap();
        toast.success(`Created ${values.label}.`);
        panel.close();
        setParams({ system: String(created.id), tab: null });
      }, "The system could not be created.");
      return ok;
    }
    if (!system) return false;
    return run(async () => {
      await updateSystem({ ...values, id: system.id }).unwrap();
      toast.success(`Saved ${values.label}.`);
      panel.close();
    }, "The system could not be saved.");
  };
  const removeSystem = () =>
    system &&
    run(async () => {
      const r = await deleteSystem(system.id).unwrap();
      toast.success(`Deleted ${system.label} with ${plural(r.talkgroups, "talkgroup")} and ${plural(r.units, "unit")}.`);
      panel.reset();
      setParams({ system: null, tab: null });
    }, "The system could not be deleted.");

  const shown = order ? order.map((id) => systems.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s) : systems;
  const move = (id: number, dir: -1 | 1) => {
    const ids = shown.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids);
  };
  const finishReorder = async () => {
    if (order && order.join() !== systems.map((s) => s.id).join()) {
      await run(async () => {
        await reorderSystems(order).unwrap();
        toast.success("Display order saved.");
      }, "The order could not be saved.");
    }
    setReordering(false);
    setOrder(null);
  };

  // ── blocked ──
  const block = (talkgroupId: number) =>
    system
      ? run(async () => {
          await blockTalkgroup({ id: system.id, talkgroupId }).unwrap();
          toast.success(`Blocked ${talkgroupId}.`);
        }, "The talkgroup could not be blocked.")
      : Promise.resolve(false);
  const unblock = (talkgroupId: number) =>
    system &&
    void run(async () => {
      await unblockTalkgroup({ id: system.id, talkgroupId }).unwrap();
      toast.success(`Unblocked ${talkgroupId}.`);
    }, "The talkgroup could not be unblocked.");
  const blockMany = async (talkgroupIds: number[]) => {
    if (!system) return false;
    return run(async () => {
      for (const talkgroupId of talkgroupIds) await blockTalkgroup({ id: system.id, talkgroupId }).unwrap();
      toast.success(`Blocked ${plural(talkgroupIds.length, "talkgroup")}.`);
    }, "The talkgroups could not be blocked.");
  };

  // ── talkgroups ──
  const currentTalkgroup = p?.kind === "talkgroup" ? (talkgroups.find((t) => t.id === p.id) ?? null) : null;
  const addTalkgroup = async (values: AdminTalkgroupInput, again: boolean) =>
    run(async () => {
      await createTalkgroup(values).unwrap();
      toast.success(`Added ${values.talkgroupId}${values.label ? ` ${values.label}` : ""}.`);
      if (!again) panel.close();
    }, "The talkgroup could not be added.");
  const saveTalkgroup = (tg: AdminTalkgroup, values: AdminTalkgroupInput) =>
    void run(async () => {
      await updateTalkgroup({ ...values, id: tg.id }).unwrap();
      toast.success(`Saved ${values.talkgroupId}.`);
    }, "The talkgroup could not be saved.");
  const removeTalkgroup = (tg: AdminTalkgroup) =>
    void run(async () => {
      await deleteTalkgroup(tg.id).unwrap();
      toast.success(`Deleted ${tg.talkgroupId}.`);
      panel.close();
    }, "The talkgroup could not be deleted.");
  const removeTalkgroups = (ids: number[]) =>
    run(async () => {
      const r = await deleteTalkgroups(ids).unwrap();
      toast.success(`Deleted ${plural(r.deleted, "talkgroup")}.`);
    }, "The talkgroups could not be deleted.");
  const bulk = (change: BulkChange) =>
    run(async () => {
      const r = await bulkTalkgroups(change).unwrap();
      toast.success(`Updated ${plural(r.updated, "talkgroup")}.`);
    }, "The talkgroups could not be updated.");

  // ── units ──
  const currentUnit = p?.kind === "unit" ? (units.find((u) => u.id === p.id) ?? null) : null;
  const saveUnit = (unit: AdminUnit | null, values: AdminUnitInput) =>
    void run(async () => {
      if (unit) await updateUnit({ ...values, id: unit.id }).unwrap();
      else await createUnit(values).unwrap();
      toast.success(`${unit ? "Saved" : "Added"} unit ${values.unitId}.`);
      panel.close();
    }, "The unit could not be saved.");
  const removeUnit = (unit: AdminUnit) =>
    void run(async () => {
      await deleteUnit(unit.id).unwrap();
      toast.success(`Deleted unit ${unit.unitId}.`);
      panel.close();
    }, "The unit could not be deleted.");

  const exportCsv = () =>
    system &&
    void run(async () => {
      const csv = await exportTalkgroups({ systemId: system.id }).unwrap();
      download(`${system.label.replace(/[^\w-]+/g, "_")}-talkgroups.csv`, csv);
    }, "The export failed.");

  const showList = desktop || !system;
  const showDetail = !!system && (desktop || paramId != null || linkedSystem != null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Systems"
        subtitle={
          <>
            {plural(systems.length, "system")}. Unknown systems and talkgroups are created from uploads when{" "}
            <Link to="/admin/settings#settings-radio" className="link">
              Settings → Radio data
            </Link>{" "}
            allows it.
          </>
        }
        actions={
          <>
            {systems.length > 1 &&
              (reordering ? (
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void finishReorder()}>
                  Done reordering
                </button>
              ) : (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReordering(true)}>
                  <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
                  Reorder
                </button>
              ))}
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={(e) => {
                setFormError(null);
                panel.open({ kind: "system-create" }, e.currentTarget);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add system
            </button>
          </>
        }
      />

      <div className={desktop ? "grid grid-cols-[16rem_1fr] gap-4" : ""}>
        {showList && (
          <div className="rounded-box border border-base-300 bg-base-100">
            {loadingSystems ? (
              <p className="p-3 text-sm text-base-content/60">Loading…</p>
            ) : (
              <SystemList systems={shown} selectedId={selectedId} onSelect={selectSystem} reordering={reordering} onMove={move} />
            )}
          </div>
        )}

        {showDetail && system && (
          <section aria-label={system.label} className="min-w-0 space-y-3">
            {!desktop && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => selectSystem(null)}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                All systems
              </button>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 sm:flex-1">
                <h2 className="truncate text-lg font-semibold">{system.label}</h2>
                <p className="text-sm text-base-content/60">
                  System {system.systemId} · {plural(system.talkgroups, "talkgroup")} · {plural(system.units, "unit")} ·{" "}
                  {system.calls24h.toLocaleString()} {system.calls24h === 1 ? "call" : "calls"} / 24 h
                  {system.lastCall ? ` · last call ${formatAgo(system.lastCall)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={(e) => {
                    setFormError(null);
                    panel.open({ kind: "system-edit" }, e.currentTarget);
                  }}
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                  System settings
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={(e) => {
                    setFormError(null);
                    panel.open({ kind: "import" }, e.currentTarget);
                  }}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Import
                </button>
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy || system.talkgroups === 0} onClick={exportCsv}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Export
                </button>
              </div>
            </div>

            <div role="tablist" aria-label="System contents" className="tabs tabs-border">
              {TABS.map((t) => {
                const count = t.id === "talkgroups" ? system.talkgroups : t.id === "units" ? system.units : system.blocked.length;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === tab}
                    className={`tab ${t.id === tab ? "tab-active" : ""}`}
                    onClick={() => selectTab(t.id)}
                  >
                    {t.label}
                    <span className="badge badge-ghost badge-sm ml-2">{count}</span>
                  </button>
                );
              })}
            </div>

            {tab === "talkgroups" && (
              <TalkgroupsTab
                key={`${system.id}-${groupParam ?? ""}-${tagParam ?? ""}`}
                systemRowId={system.id}
                talkgroups={talkgroups}
                groups={groups ?? []}
                tags={tags ?? []}
                blocked={blockedSet}
                loading={loadingTalkgroups}
                busy={busy}
                initialGroup={groupParam}
                initialTag={tagParam}
                openId={p?.kind === "talkgroup" ? p.id : null}
                onOpen={(tg, el) => {
                  setFormError(null);
                  panel.open({ kind: "talkgroup", id: tg.id }, el);
                }}
                onAdd={() => {
                  setFormError(null);
                  panel.open({ kind: "talkgroup-create" });
                }}
                onBulk={bulk}
                onBlockMany={blockMany}
                onDeleteMany={removeTalkgroups}
              />
            )}
            {tab === "units" && (
              <UnitsTab
                systemRowId={system.id}
                units={units}
                loading={loadingUnits}
                openId={p?.kind === "unit" ? p.id : null}
                onOpen={(u, el) => {
                  setFormError(null);
                  panel.open({ kind: "unit", id: u.id }, el);
                }}
                onAdd={() => {
                  setFormError(null);
                  panel.open({ kind: "unit-create" });
                }}
              />
            )}
            {tab === "blocked" && (
              <BlockedTab
                blocked={system.blocked}
                talkgroups={talkgroups}
                autoPopulate={system.autoPopulateTalkgroups === 1}
                busy={busy}
                onBlock={block}
                onUnblock={unblock}
              />
            )}
          </section>
        )}

        {desktop && !system && !loadingSystems && systems.length > 0 && (
          <p className="p-4 text-sm text-base-content/60">Choose a system.</p>
        )}
      </div>

      {p?.kind === "system-create" && (
        <SystemForm
          system={null}
          nextOrder={systems.length}
          busy={busy}
          error={formError}
          onSubmit={(v) => void saveSystem(v)}
          onDelete={() => undefined}
          onClose={panel.close}
        />
      )}
      {p?.kind === "system-edit" && system && (
        <SystemForm
          key={system.id}
          system={system}
          nextOrder={systems.length}
          busy={busy}
          error={formError}
          onSubmit={(v) => void saveSystem(v)}
          onDelete={() => void removeSystem()}
          onClose={panel.close}
        />
      )}
      {p?.kind === "import" && system && (
        <ImportWizard
          system={system}
          onClose={panel.close}
          onDone={(r) => {
            toast.success(`Imported: ${plural(r.created, "new talkgroup")}, ${r.updated} updated, ${r.unchanged} unchanged.`);
            panel.close();
          }}
        />
      )}
      {p?.kind === "talkgroup-create" && system && (
        <TalkgroupForm
          systemId={system.id}
          groups={groups ?? []}
          tags={tags ?? []}
          busy={busy}
          error={formError}
          onSubmit={addTalkgroup}
          onClose={panel.close}
        />
      )}
      {currentTalkgroup && system && (
        <TalkgroupDetails
          key={currentTalkgroup.id}
          systemRowId={system.id}
          talkgroup={currentTalkgroup}
          groups={groups ?? []}
          tags={tags ?? []}
          blocked={blockedSet.has(currentTalkgroup.talkgroupId)}
          busy={busy}
          error={formError}
          onSave={(v) => saveTalkgroup(currentTalkgroup, v)}
          onBlock={() => void block(currentTalkgroup.talkgroupId)}
          onDelete={() => removeTalkgroup(currentTalkgroup)}
          onClose={panel.close}
        />
      )}
      {p?.kind === "unit-create" && system && (
        <UnitForm
          systemId={system.id}
          unit={null}
          busy={busy}
          error={formError}
          onSubmit={(v) => saveUnit(null, v)}
          onDelete={() => undefined}
          onClose={panel.close}
        />
      )}
      {currentUnit && system && (
        <UnitForm
          key={currentUnit.id}
          systemId={system.id}
          unit={currentUnit}
          busy={busy}
          error={formError}
          onSubmit={(v) => saveUnit(currentUnit, v)}
          onDelete={() => removeUnit(currentUnit)}
          onClose={panel.close}
        />
      )}
    </div>
  );
}
