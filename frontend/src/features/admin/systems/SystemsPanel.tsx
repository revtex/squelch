import { useState, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Pencil, Trash2, Plus, ChevronDown, Radio, Users } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useListSystemsQuery,
  useCreateSystemMutation,
  useUpdateSystemMutation,
  useDeleteSystemMutation,
  useListTalkgroupsQuery,
  useCreateTalkgroupMutation,
  useUpdateTalkgroupMutation,
  useDeleteTalkgroupMutation,
  useListUnitsQuery,
  useCreateUnitMutation,
  useUpdateUnitMutation,
  useDeleteUnitMutation,
  useListGroupsQuery,
  useListTagsQuery,
} from "@/features/admin/_shell";
import type { AdminSystem, AdminTalkgroup, AdminUnit } from "@/types";

// ─── System card ───

function SystemCard({
  system,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onToggleAutoPopulate,
  talkgroups,
  units,
  onEditTg,
  onDeleteTg,
  onCreateTg,
  onEditUnit,
  onDeleteUnit,
  onCreateUnit,
  unitSearchFilter,
  onUnitSearchChange,
  talkgroupSearchFilter,
  onTalkgroupSearchChange,
}: {
  system: AdminSystem;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAutoPopulate: () => void;
  talkgroups: AdminTalkgroup[];
  units: AdminUnit[];
  onEditTg: (tg: AdminTalkgroup) => void;
  onDeleteTg: (tg: AdminTalkgroup) => void;
  onCreateTg: () => void;
  onEditUnit: (u: AdminUnit) => void;
  onDeleteUnit: (u: AdminUnit) => void;
  onCreateUnit: () => void;
  unitSearchFilter: string;
  onUnitSearchChange: (value: string) => void;
  talkgroupSearchFilter: string;
  onTalkgroupSearchChange: (value: string) => void;
}) {
  return (
    <div className="card bg-base-200">
      <div className="card-body p-4">
        {/* Header row — always visible */}
        <div className="flex flex-col gap-2">
          <button
            className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
            onClick={onToggle}
          >
            <ChevronDown
              className={`w-5 h-5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
            />
            <div className="min-w-0">
              <span className="font-semibold text-base">{system.label}</span>
              <span className="text-sm text-base-content/60 ml-2">
                ID {system.systemId}
              </span>
            </div>
          </button>

          <div className="flex items-center gap-3 flex-wrap pl-8">
            <div
              className="tooltip tooltip-bottom flex items-center gap-2 text-xs text-base-content/60"
              data-tip="Talkgroups"
            >
              <Radio className="w-3.5 h-3.5" />
              {talkgroups.length}
            </div>
            <div
              className="tooltip tooltip-bottom flex items-center gap-2 text-xs text-base-content/60"
              data-tip="Units"
            >
              <Users className="w-3.5 h-3.5" />
              {units.length}
            </div>
            <label className="flex items-center gap-1 cursor-pointer">
              <span className="text-xs text-base-content/60">
                TG Auto Populate
              </span>
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-xs"
                checked={system.autoPopulateTalkgroups === 1}
                onChange={onToggleAutoPopulate}
              />
            </label>
            <div className="flex-1" />
            <button
              className="btn btn-ghost btn-sm btn-square"
              onClick={onEdit}
              aria-label="Edit system"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-square"
              onClick={onDelete}
              aria-label="Delete system"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="mt-4 flex flex-col gap-6">
            {/* Talkgroups */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Radio className="w-4 h-4" />
                  Talkgroups ({talkgroups.length})
                </h4>
                <button className="btn btn-primary btn-xs" onClick={onCreateTg}>
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>
              <div className="mb-3">
                <input
                  type="text"
                  placeholder="Search by ID, label, or name..."
                  value={talkgroupSearchFilter}
                  onChange={(e) => onTalkgroupSearchChange(e.target.value)}
                  className="input input-sm input-bordered w-full"
                />
              </div>
              <TalkgroupList
                talkgroups={talkgroups}
                onEdit={onEditTg}
                onDelete={onDeleteTg}
                searchFilter={talkgroupSearchFilter}
              />
            </div>

            {/* Units */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Units ({units.length})
                </h4>
                <button
                  className="btn btn-primary btn-xs"
                  onClick={onCreateUnit}
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>
              <div className="mb-3">
                <input
                  type="text"
                  placeholder="Search by ID or label..."
                  value={unitSearchFilter}
                  onChange={(e) => onUnitSearchChange(e.target.value)}
                  className="input input-sm input-bordered w-full"
                />
              </div>
              {units.length === 0 ? (
                <p className="text-sm opacity-60 py-2">No units</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-zebra table-xs w-full">
                    <thead>
                      <tr>
                        <th>Unit ID</th>
                        <th>Label</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {units
                        .filter((u) => {
                          if (unitSearchFilter === "") return true;
                          const q = unitSearchFilter.toLowerCase();
                          return (
                            String(u.unitId).includes(q) ||
                            (u.label ?? "").toLowerCase().includes(q)
                          );
                        })
                        .map((u) => (
                          <tr key={u.id}>
                            <td>{u.unitId}</td>
                            <td>{u.label ?? "—"}</td>
                            <td className="flex gap-1">
                              <button
                                className="btn btn-ghost btn-xs"
                                onClick={() => onEditUnit(u)}
                                aria-label="Edit unit"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                className="btn btn-ghost btn-xs"
                                onClick={() => onDeleteUnit(u)}
                                aria-label="Delete unit"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Virtualized talkgroup list ───

function TalkgroupList({
  talkgroups,
  onEdit,
  onDelete,
  searchFilter,
}: {
  talkgroups: AdminTalkgroup[];
  onEdit: (tg: AdminTalkgroup) => void;
  onDelete: (tg: AdminTalkgroup) => void;
  searchFilter: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!searchFilter) return talkgroups;
    const q = searchFilter.toLowerCase();
    return talkgroups.filter(
      (tg) =>
        String(tg.talkgroupId).includes(q) ||
        (tg.label ?? "").toLowerCase().includes(q) ||
        (tg.name ?? "").toLowerCase().includes(q),
    );
  }, [talkgroups, searchFilter]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 41,
    overscan: 10,
  });

  if (filtered.length === 0) {
    return <p className="text-sm opacity-60 py-2">No talkgroups</p>;
  }

  // For small lists, skip virtualization
  if (filtered.length <= 50) {
    return (
      <div className="overflow-x-auto">
        <table className="table table-zebra table-xs w-full">
          <thead>
            <tr>
              <th>TG ID</th>
              <th>Label</th>
              <th>Name</th>
              <th>Frequency</th>
              <th>Group</th>
              <th>Tag</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tg) => (
              <tr key={tg.id}>
                <td>{tg.talkgroupId}</td>
                <td>{tg.label ?? "—"}</td>
                <td>{tg.name ?? "—"}</td>
                <td>
                  {tg.frequency != null
                    ? `${(tg.frequency / 1e6).toFixed(4)} MHz`
                    : "—"}
                </td>
                <td>{tg.groupId ?? "—"}</td>
                <td>{tg.tagId ?? "—"}</td>
                <td className="flex gap-1">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => onEdit(tg)}
                    aria-label="Edit talkgroup"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => onDelete(tg)}
                    aria-label="Delete talkgroup"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table table-zebra table-xs w-full">
          <thead>
            <tr>
              <th>TG ID</th>
              <th>Label</th>
              <th>Name</th>
              <th>Frequency</th>
              <th>Group</th>
              <th>Tag</th>
              <th>Actions</th>
            </tr>
          </thead>
        </table>
      </div>
      <div ref={parentRef} className="max-h-100 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const tg = filtered[virtualRow.index];
            return (
              <div
                key={tg.id}
                className="flex items-center text-xs border-b border-base-300"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <span className="w-[14%] px-2 truncate">{tg.talkgroupId}</span>
                <span className="w-[14%] px-2 truncate">{tg.label ?? "—"}</span>
                <span className="w-[14%] px-2 truncate">{tg.name ?? "—"}</span>
                <span className="w-[18%] px-2 truncate">
                  {tg.frequency != null
                    ? `${(tg.frequency / 1e6).toFixed(4)} MHz`
                    : "—"}
                </span>
                <span className="w-[10%] px-2 truncate">
                  {tg.groupId ?? "—"}
                </span>
                <span className="w-[10%] px-2 truncate">{tg.tagId ?? "—"}</span>
                <span className="w-[20%] px-2 flex gap-1">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => onEdit(tg)}
                    aria-label="Edit talkgroup"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => onDelete(tg)}
                    aria-label="Delete talkgroup"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───

const LED_COLORS = [
  "blue",
  "cyan",
  "green",
  "magenta",
  "red",
  "white",
  "yellow",
] as const;

interface SystemFormState {
  systemId: string;
  label: string;
  led: string;
  blacklists: string;
}

interface TgFormState {
  talkgroupId: string;
  label: string;
  name: string;
  frequency: string;
  led: string;
  groupId: string;
  tagId: string;
}

interface UnitFormState {
  unitId: string;
  label: string;
}

export default function SystemsPanel() {
  const { data: systems, isLoading: loadingSystems } = useListSystemsQuery();
  const { data: allTalkgroups } = useListTalkgroupsQuery();
  const { data: allUnits } = useListUnitsQuery();
  const { data: groups } = useListGroupsQuery();
  const { data: tags } = useListTagsQuery();
  const [createSystem] = useCreateSystemMutation();
  const [updateSystem] = useUpdateSystemMutation();
  const [deleteSystem] = useDeleteSystemMutation();
  const [createTalkgroup] = useCreateTalkgroupMutation();
  const [updateTalkgroup] = useUpdateTalkgroupMutation();
  const [deleteTalkgroup] = useDeleteTalkgroupMutation();
  const [createUnit] = useCreateUnitMutation();
  const [updateUnit] = useUpdateUnitMutation();
  const [deleteUnit] = useDeleteUnitMutation();

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [unitSearchFilters, setUnitSearchFilters] = useState<
    Map<number, string>
  >(new Map());
  const [talkgroupSearchFilters, setTalkgroupSearchFilters] = useState<
    Map<number, string>
  >(new Map());

  // System modal
  const [sysModalOpen, setSysModalOpen] = useState(false);
  const [editingSysId, setEditingSysId] = useState<number | null>(null);
  const [sysForm, setSysForm] = useState<SystemFormState>({
    systemId: "",
    label: "",
    led: "",
    blacklists: "",
  });

  // Talkgroup modal
  const [tgModalOpen, setTgModalOpen] = useState(false);
  const [editingTgId, setEditingTgId] = useState<number | null>(null);
  const [tgSystemId, setTgSystemId] = useState<number>(0);
  const [tgForm, setTgForm] = useState<TgFormState>({
    talkgroupId: "",
    label: "",
    name: "",
    frequency: "",
    led: "",
    groupId: "",
    tagId: "",
  });

  // Unit modal
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [unitSystemId, setUnitSystemId] = useState<number>(0);
  const [unitForm, setUnitForm] = useState<UnitFormState>({
    unitId: "",
    label: "",
  });

  const showError = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  }, []);

  const sortedSystems = useMemo(
    () => (systems ? [...systems].sort((a, b) => a.order - b.order) : []),
    [systems],
  );

  const tgBySystem = useMemo(() => {
    const map = new Map<number, AdminTalkgroup[]>();
    if (allTalkgroups) {
      for (const tg of allTalkgroups) {
        const list = map.get(tg.systemId) ?? [];
        list.push(tg);
        map.set(tg.systemId, list);
      }
    }
    return map;
  }, [allTalkgroups]);

  const unitsBySystem = useMemo(() => {
    const map = new Map<number, AdminUnit[]>();
    if (allUnits) {
      for (const u of allUnits) {
        const list = map.get(u.systemId) ?? [];
        list.push(u);
        map.set(u.systemId, list);
      }
    }
    return map;
  }, [allUnits]);

  // ── Expand / collapse ──

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── System CRUD ──

  const openCreateSystem = () => {
    setEditingSysId(null);
    setSysForm({ systemId: "", label: "", led: "", blacklists: "" });
    setSysModalOpen(true);
  };

  const openEditSystem = (sys: AdminSystem) => {
    setEditingSysId(sys.id);
    setSysForm({
      systemId: String(sys.systemId),
      label: sys.label,
      led: sys.led ?? "",
      blacklists: sys.blacklistsJson
        ? (() => {
            try {
              const arr = JSON.parse(sys.blacklistsJson) as number[];
              return arr.join(",");
            } catch {
              return "";
            }
          })()
        : "",
    });
    setSysModalOpen(true);
  };

  const handleSystemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Parse blacklists CSV → JSON array
    const blacklistIds = sysForm.blacklists
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => !isNaN(n));
    const blacklistsJson =
      blacklistIds.length > 0 ? JSON.stringify(blacklistIds) : null;
    try {
      if (editingSysId != null) {
        const existing = sortedSystems.find((s) => s.id === editingSysId);
        if (!existing) {
          showError("System not found");
          return;
        }
        await updateSystem({
          id: editingSysId,
          systemId: Number(sysForm.systemId),
          label: sysForm.label,
          autoPopulateTalkgroups: existing.autoPopulateTalkgroups,
          led: sysForm.led || null,
          blacklistsJson,
          order: existing.order,
        }).unwrap();
      } else {
        await createSystem({
          systemId: Number(sysForm.systemId),
          label: sysForm.label,
          autoPopulateTalkgroups: 1,
          blacklistsJson,
          led: sysForm.led || null,
          order: sortedSystems.length,
        }).unwrap();
      }
      setSysModalOpen(false);
    } catch {
      showError(
        editingSysId ? "Failed to update system" : "Failed to create system",
      );
    }
  };

  const handleDeleteSystem = async (sys: AdminSystem) => {
    if (
      !window.confirm(
        `Delete system "${sys.label}" and all its talkgroups/units?`,
      )
    )
      return;
    try {
      await deleteSystem(sys.id).unwrap();
    } catch {
      showError("Failed to delete system");
    }
  };

  const handleToggleAutoPopulate = async (sys: AdminSystem) => {
    try {
      await updateSystem({
        id: sys.id,
        systemId: sys.systemId,
        label: sys.label,
        autoPopulateTalkgroups: sys.autoPopulateTalkgroups ? 0 : 1,
        led: sys.led ?? null,
        blacklistsJson: sys.blacklistsJson ?? null,
        order: sys.order,
      }).unwrap();
    } catch {
      showError("Failed to update system");
    }
  };

  // ── Talkgroup CRUD ──

  const openCreateTg = (systemId: number) => {
    setEditingTgId(null);
    setTgSystemId(systemId);
    setTgForm({
      talkgroupId: "",
      label: "",
      name: "",
      frequency: "",
      led: "",
      groupId: "",
      tagId: "",
    });
    setTgModalOpen(true);
  };

  const openEditTg = (tg: AdminTalkgroup) => {
    setEditingTgId(tg.id);
    setTgSystemId(tg.systemId);
    setTgForm({
      talkgroupId: String(tg.talkgroupId),
      label: tg.label ?? "",
      name: tg.name ?? "",
      frequency: tg.frequency != null ? String(tg.frequency) : "",
      led: tg.led ?? "",
      groupId: tg.groupId != null ? String(tg.groupId) : "",
      tagId: tg.tagId != null ? String(tg.tagId) : "",
    });
    setTgModalOpen(true);
  };

  const handleTgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingTgId != null) {
        await updateTalkgroup({
          id: editingTgId,
          talkgroupId: Number(tgForm.talkgroupId),
          label: tgForm.label || null,
          name: tgForm.name || null,
          frequency: tgForm.frequency ? Number(tgForm.frequency) : null,
          led: tgForm.led || null,
          groupId: tgForm.groupId ? Number(tgForm.groupId) : null,
          tagId: tgForm.tagId ? Number(tgForm.tagId) : null,
        }).unwrap();
      } else {
        await createTalkgroup({
          systemId: tgSystemId,
          talkgroupId: Number(tgForm.talkgroupId),
          label: tgForm.label || null,
          name: tgForm.name || null,
          frequency: tgForm.frequency ? Number(tgForm.frequency) : null,
          led: tgForm.led || null,
          groupId: tgForm.groupId ? Number(tgForm.groupId) : null,
          tagId: tgForm.tagId ? Number(tgForm.tagId) : null,
          order: tgBySystem.get(tgSystemId)?.length ?? 0,
        }).unwrap();
      }
      setTgModalOpen(false);
    } catch {
      showError(
        editingTgId
          ? "Failed to update talkgroup"
          : "Failed to create talkgroup",
      );
    }
  };

  const handleDeleteTg = async (tg: AdminTalkgroup) => {
    if (!window.confirm(`Delete talkgroup ${tg.talkgroupId}?`)) return;
    try {
      await deleteTalkgroup(tg.id).unwrap();
    } catch {
      showError("Failed to delete talkgroup");
    }
  };

  // ── Unit CRUD ──

  const openCreateUnit = (systemId: number) => {
    setEditingUnitId(null);
    setUnitSystemId(systemId);
    setUnitForm({ unitId: "", label: "" });
    setUnitModalOpen(true);
  };

  const openEditUnit = (unit: AdminUnit) => {
    setEditingUnitId(unit.id);
    setUnitSystemId(unit.systemId);
    setUnitForm({
      unitId: String(unit.unitId),
      label: unit.label ?? "",
    });
    setUnitModalOpen(true);
  };

  const handleUnitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUnitId != null) {
        await updateUnit({
          id: editingUnitId,
          unitId: Number(unitForm.unitId),
          label: unitForm.label || null,
        }).unwrap();
      } else {
        await createUnit({
          systemId: unitSystemId,
          unitId: Number(unitForm.unitId),
          label: unitForm.label || null,
          order: unitsBySystem.get(unitSystemId)?.length ?? 0,
        }).unwrap();
      }
      setUnitModalOpen(false);
    } catch {
      showError(
        editingUnitId ? "Failed to update unit" : "Failed to create unit",
      );
    }
  };

  const handleDeleteUnit = async (unit: AdminUnit) => {
    if (!window.confirm(`Delete unit ${unit.unitId}?`)) return;
    try {
      await deleteUnit(unit.id).unwrap();
    } catch {
      showError("Failed to delete unit");
    }
  };

  if (loadingSystems) {
    return (
      <div className="flex justify-center py-12">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Systems</h1>
      <p className="text-sm text-base-content/70 mb-4">
        Define radio systems and their talkgroups. Systems represent a radio
        network (e.g. a county or agency). Each system contains talkgroups and
        units. Click a system to manage its talkgroups and units.
      </p>

      <p className="text-xs text-base-content/60 mb-4">
        Whether uploads may create systems that do not exist yet is set under{" "}
        <Link to="/admin/settings#settings-radio" className="link">
          Settings → Radio data
        </Link>
        .
      </p>

      <div className="flex flex-col gap-3">
        {sortedSystems.map((sys) => (
          <SystemCard
            key={sys.id}
            system={sys}
            expanded={expandedIds.has(sys.id)}
            onToggle={() => toggleExpand(sys.id)}
            onEdit={() => openEditSystem(sys)}
            onDelete={() => handleDeleteSystem(sys)}
            onToggleAutoPopulate={() => handleToggleAutoPopulate(sys)}
            talkgroups={tgBySystem.get(sys.id) ?? []}
            units={unitsBySystem.get(sys.id) ?? []}
            onEditTg={openEditTg}
            onDeleteTg={handleDeleteTg}
            onCreateTg={() => openCreateTg(sys.id)}
            onEditUnit={openEditUnit}
            onDeleteUnit={handleDeleteUnit}
            onCreateUnit={() => openCreateUnit(sys.id)}
            unitSearchFilter={unitSearchFilters.get(sys.id) ?? ""}
            onUnitSearchChange={(value) => {
              const next = new Map(unitSearchFilters);
              if (value === "") {
                next.delete(sys.id);
              } else {
                next.set(sys.id, value);
              }
              setUnitSearchFilters(next);
            }}
            talkgroupSearchFilter={talkgroupSearchFilters.get(sys.id) ?? ""}
            onTalkgroupSearchChange={(value) => {
              const next = new Map(talkgroupSearchFilters);
              if (value === "") {
                next.delete(sys.id);
              } else {
                next.set(sys.id, value);
              }
              setTalkgroupSearchFilters(next);
            }}
          />
        ))}
        {sortedSystems.length === 0 && (
          <p className="text-center opacity-60 py-8">No systems found</p>
        )}
      </div>

      <div className="mt-4">
        <button className="btn btn-primary" onClick={openCreateSystem}>
          <Plus className="w-4 h-4" />
          Add System
        </button>
      </div>

      {/* System Modal */}
      <dialog className={`modal ${sysModalOpen ? "modal-open" : ""}`}>
        <div className="modal-box">
          <h3 className="font-bold text-lg mb-4">
            {editingSysId != null ? "Edit System" : "Create System"}
          </h3>
          <form onSubmit={handleSystemSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col w-full">
              <span className="text-sm">System ID</span>
              <span className="text-xs text-base-content/60">
                Numeric identifier matching your radio recorder&apos;s system
                number
              </span>
              <input
                type="number"
                className="input w-full"
                value={sysForm.systemId}
                onChange={(e) =>
                  setSysForm((p) => ({ ...p, systemId: e.target.value }))
                }
                required
              />
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">Label</span>
              <span className="text-xs text-base-content/60">
                Display name shown in the scanner (e.g. &quot;Lake County
                Fire&quot;)
              </span>
              <input
                type="text"
                className="input w-full"
                value={sysForm.label}
                onChange={(e) =>
                  setSysForm((p) => ({ ...p, label: e.target.value }))
                }
                required
              />
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">LED Color</span>
              <span className="text-xs text-base-content/60">
                Indicator color when playing audio from this system
              </span>
              <select
                className="select w-full"
                value={sysForm.led}
                onChange={(e) =>
                  setSysForm((p) => ({ ...p, led: e.target.value }))
                }
              >
                <option value="">Default (green)</option>
                {LED_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">Blacklists</span>
              <span className="text-xs text-base-content/60">
                Comma-separated talkgroup IDs to exclude when auto-populate is
                on
              </span>
              <textarea
                className="textarea w-full"
                rows={2}
                placeholder="e.g. 1234,5678"
                value={sysForm.blacklists}
                onChange={(e) =>
                  setSysForm((p) => ({ ...p, blacklists: e.target.value }))
                }
              />
            </label>
            <div className="modal-action">
              <button
                type="button"
                className="btn"
                onClick={() => setSysModalOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingSysId != null ? "Save" : "Create"}
              </button>
            </div>
          </form>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="button" onClick={() => setSysModalOpen(false)}>
            close
          </button>
        </form>
      </dialog>

      {/* Talkgroup Modal */}
      <dialog className={`modal ${tgModalOpen ? "modal-open" : ""}`}>
        <div className="modal-box">
          <h3 className="font-bold text-lg mb-4">
            {editingTgId != null ? "Edit Talkgroup" : "Add Talkgroup"}
          </h3>
          <form onSubmit={handleTgSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col w-full">
              <span className="text-sm">Talkgroup ID</span>
              <span className="text-xs text-base-content/60">
                Numeric ID matching the talkgroup in your radio system
              </span>
              <input
                type="number"
                className="input w-full"
                value={tgForm.talkgroupId}
                onChange={(e) =>
                  setTgForm((p) => ({ ...p, talkgroupId: e.target.value }))
                }
                required
              />
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">Label</span>
              <span className="text-xs text-base-content/60">
                Short label shown in the scanner display (e.g. &quot;FD
                Dispatch&quot;)
              </span>
              <input
                type="text"
                className="input w-full"
                value={tgForm.label}
                onChange={(e) =>
                  setTgForm((p) => ({ ...p, label: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">Name</span>
              <span className="text-xs text-base-content/60">
                Full descriptive name (e.g. &quot;Fire Department
                Dispatch&quot;)
              </span>
              <input
                type="text"
                className="input w-full"
                value={tgForm.name}
                onChange={(e) =>
                  setTgForm((p) => ({ ...p, name: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">Group</span>
              <span className="text-xs text-base-content/60">
                Category for organizing talkgroups in the scanner (e.g.
                &quot;Fire&quot;, &quot;Police&quot;)
              </span>
              <select
                className="select w-full"
                value={tgForm.groupId}
                onChange={(e) =>
                  setTgForm((p) => ({ ...p, groupId: e.target.value }))
                }
              >
                <option value="">— none —</option>
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">Tag</span>
              <span className="text-xs text-base-content/60">
                Secondary classification for filtering (e.g. &quot;Law
                Dispatch&quot;, &quot;EMS&quot;)
              </span>
              <select
                className="select w-full"
                value={tgForm.tagId}
                onChange={(e) =>
                  setTgForm((p) => ({ ...p, tagId: e.target.value }))
                }
              >
                <option value="">— none —</option>
                {(tags ?? []).map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">LED Color</span>
              <span className="text-xs text-base-content/60">
                Overrides system color
              </span>
              <select
                className="select w-full"
                value={tgForm.led}
                onChange={(e) =>
                  setTgForm((p) => ({ ...p, led: e.target.value }))
                }
              >
                <option value="">Default (system color)</option>
                {LED_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">Frequency (Hz)</span>
              <span className="text-xs text-base-content/60">
                Cosmetic frequency shown in the scanner display, not used for
                tuning
              </span>
              <input
                type="number"
                className="input w-full"
                value={tgForm.frequency}
                min={0}
                placeholder="e.g. 155325000"
                onChange={(e) =>
                  setTgForm((p) => ({ ...p, frequency: e.target.value }))
                }
              />
            </label>
            <div className="modal-action">
              <button
                type="button"
                className="btn"
                onClick={() => setTgModalOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingTgId != null ? "Save" : "Create"}
              </button>
            </div>
          </form>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="button" onClick={() => setTgModalOpen(false)}>
            close
          </button>
        </form>
      </dialog>

      {/* Unit Modal */}
      <dialog className={`modal ${unitModalOpen ? "modal-open" : ""}`}>
        <div className="modal-box">
          <h3 className="font-bold text-lg mb-4">
            {editingUnitId != null ? "Edit Unit" : "Add Unit"}
          </h3>
          <form onSubmit={handleUnitSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col w-full">
              <span className="text-sm">Unit ID</span>
              <input
                type="number"
                className="input w-full"
                value={unitForm.unitId}
                onChange={(e) =>
                  setUnitForm((p) => ({ ...p, unitId: e.target.value }))
                }
                required
              />
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm">Label</span>
              <input
                type="text"
                className="input w-full"
                value={unitForm.label}
                onChange={(e) =>
                  setUnitForm((p) => ({ ...p, label: e.target.value }))
                }
              />
            </label>
            <div className="modal-action">
              <button
                type="button"
                className="btn"
                onClick={() => setUnitModalOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingUnitId != null ? "Save" : "Create"}
              </button>
            </div>
          </form>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="button" onClick={() => setUnitModalOpen(false)}>
            close
          </button>
        </form>
      </dialog>

      {toast && (
        <div className="toast toast-end">
          <div className="alert alert-error">
            <span>{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}
