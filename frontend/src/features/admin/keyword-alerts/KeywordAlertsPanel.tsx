import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, RotateCcw } from "lucide-react";
import {
  DataTable,
  FilterChips,
  PageHeader,
  formatAgo,
  useCreateKeywordRuleMutation,
  useCreateKeywordTargetMutation,
  useDeleteKeywordRuleMutation,
  useDeleteKeywordTargetMutation,
  useKeywordAlertDryRunMutation,
  useListKeywordRulesQuery,
  useListKeywordTargetsQuery,
  useListSystemsQuery,
  useListTalkgroupsQuery,
  useTestKeywordTargetMutation,
  useToast,
  useUpdateKeywordRuleMutation,
  useUpdateKeywordTargetMutation,
  type Column,
} from "@/features/admin/_shell";
import SystemsPicker from "@/features/admin/forwarding/SystemsPicker";
import type {
  AdminKeywordRule,
  AdminKeywordTarget,
  AdminSystem,
  AdminTalkgroup,
  KeywordTargetType,
} from "@/types";

type Tab = "rules" | "targets";

function tabFrom(raw: string | null): Tab {
  return raw === "targets" ? "targets" : "rules";
}

function parseIds(json: string | null): number[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

function patternsLines(json: string): string {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as string[]).join("\n") : "";
  } catch {
    return "";
  }
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Match transcript text and notify Slack, a display, or a generic URL. */
export default function KeywordAlertsPanel() {
  const [search, setSearch] = useSearchParams();
  const tab = tabFrom(search.get("tab"));
  const toast = useToast();

  const { data: rules, isLoading: loadingRules, refetch: refetchRules } = useListKeywordRulesQuery();
  const { data: targets, isLoading: loadingTargets, refetch: refetchTargets } = useListKeywordTargetsQuery();
  const { data: systems } = useListSystemsQuery();
  const { data: talkgroups } = useListTalkgroupsQuery(undefined);

  const [createRule] = useCreateKeywordRuleMutation();
  const [updateRule] = useUpdateKeywordRuleMutation();
  const [deleteRule] = useDeleteKeywordRuleMutation();
  const [createTarget] = useCreateKeywordTargetMutation();
  const [updateTarget] = useUpdateKeywordTargetMutation();
  const [deleteTarget] = useDeleteKeywordTargetMutation();
  const [testTarget] = useTestKeywordTargetMutation();
  const [dryRun] = useKeywordAlertDryRunMutation();

  const [editingRule, setEditingRule] = useState<AdminKeywordRule | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [editingTarget, setEditingTarget] = useState<AdminKeywordTarget | null>(null);
  const [creatingTarget, setCreatingTarget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dryText, setDryText] = useState("Engine 413 responding to Queen Creek");
  const [dryMatched, setDryMatched] = useState<string[] | null>(null);

  const systemList = useMemo(() => systems ?? [], [systems]);
  const tgList = useMemo(() => talkgroups ?? [], [talkgroups]);
  const ruleRows = useMemo(
    () => [...(rules ?? [])].sort((a, b) => a.order - b.order || a.id - b.id),
    [rules],
  );
  const targetRows = useMemo(
    () => [...(targets ?? [])].sort((a, b) => a.order - b.order || a.id - b.id),
    [targets],
  );

  const selectTab = (next: Tab) => {
    setCreatingRule(false);
    setEditingRule(null);
    setCreatingTarget(false);
    setEditingTarget(null);
    const params = new URLSearchParams(search);
    if (next === "rules") params.delete("tab");
    else params.set("tab", next);
    setSearch(params, { replace: true });
  };

  const ruleColumns: Column<AdminKeywordRule>[] = [
    {
      id: "label",
      header: "Rule",
      phone: "title",
      sortValue: (r) => r.label,
      cell: (r) => (
        <span className="font-medium">
          {r.label}
          {r.disabled ? <span className="badge badge-neutral ms-2">off</span> : null}
        </span>
      ),
    },
    {
      id: "patterns",
      header: "Patterns",
      phone: "show",
      cell: (r) => {
        let count = 0;
        try {
          count = (JSON.parse(r.patternsJson) as unknown[]).length;
        } catch {
          count = 0;
        }
        return <span>{count} pattern{count === 1 ? "" : "s"}</span>;
      },
    },
    {
      id: "cooldown",
      header: "Cooldown",
      phone: "show",
      cell: (r) => <span>{r.cooldownSec}s</span>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      phone: "show",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setCreatingRule(false); setEditingRule(r); }}>
            Edit
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => void (async () => {
              setBusy(true);
              try {
                await deleteRule(r.id).unwrap();
                toast.success(`Deleted ${r.label}.`);
                refetchRules();
              } catch (e) {
                toast.error(message(e, "Could not delete the rule."));
              } finally {
                setBusy(false);
              }
            })()}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const targetColumns: Column<AdminKeywordTarget>[] = [
    {
      id: "label",
      header: "Target",
      phone: "title",
      sortValue: (t) => t.label || t.url,
      cell: (t) => (
        <span className="font-medium">
          {t.label || t.url}
          {t.disabled ? <span className="badge badge-neutral ms-2">off</span> : null}
        </span>
      ),
    },
    {
      id: "type",
      header: "Type",
      phone: "show",
      cell: (t) => <span className="badge badge-ghost">{t.type}</span>,
    },
    {
      id: "last",
      header: "Last delivery",
      phone: "show",
      cell: (t) =>
        t.last ? (
          <span className={t.last.ok ? "text-success" : "text-error"}>
            {t.last.ok ? "ok" : t.last.error || "failed"} · {formatAgo(t.last.at)}
          </span>
        ) : (
          <span className="text-base-content-dim">never</span>
        ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      phone: "show",
      cell: (t) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy || !!t.disabled}
            onClick={() => void (async () => {
              setBusy(true);
              try {
                const r = await testTarget(t.id).unwrap();
                toast.success(r.ok ? `Test ok (${r.status}).` : `Test failed: ${r.error || r.status}`);
                refetchTargets();
              } catch (e) {
                toast.error(message(e, "Test failed."));
              } finally {
                setBusy(false);
              }
            })()}
          >
            Test
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setCreatingTarget(false); setEditingTarget(t); }}>
            Edit
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => void (async () => {
              setBusy(true);
              try {
                await deleteTarget(t.id).unwrap();
                toast.success("Deleted the target.");
                refetchTargets();
              } catch (e) {
                toast.error(message(e, "Could not delete the target."));
              } finally {
                setBusy(false);
              }
            })()}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Keyword alerts"
        subtitle="After a call is transcribed, match terms and post to Slack, a display, or any URL."
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          label="Show"
          value={tab}
          onChange={selectTab}
          options={[
            { id: "rules", label: "Rules", count: ruleRows.length },
            { id: "targets", label: "Targets", count: targetRows.length },
          ]}
        />
        {tab === "rules" ? (
          <button type="button" className="btn btn-sm ms-auto" onClick={() => { setEditingRule(null); setCreatingRule(true); }}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add rule
          </button>
        ) : (
          <button type="button" className="btn btn-sm ms-auto" onClick={() => { setEditingTarget(null); setCreatingTarget(true); }}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add target
          </button>
        )}
      </div>

      {tab === "rules" && (
        <>
          {(creatingRule || editingRule) && (
            <RuleForm
              key={editingRule?.id ?? "new"}
              initial={editingRule}
              systems={systemList}
              talkgroups={tgList}
              busy={busy}
              onCancel={() => { setCreatingRule(false); setEditingRule(null); }}
              onSave={async (values) => {
                setBusy(true);
                try {
                  if (editingRule) {
                    await updateRule({ id: editingRule.id, ...values }).unwrap();
                    toast.success("Rule saved.");
                  } else {
                    await createRule(values).unwrap();
                    toast.success("Rule created.");
                  }
                  setCreatingRule(false);
                  setEditingRule(null);
                  refetchRules();
                } catch (e) {
                  toast.error(message(e, "Could not save the rule."));
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          <DataTable
            columns={ruleColumns}
            rows={ruleRows}
            rowKey={(r) => r.id}
            caption="Keyword rules"
            loading={loadingRules && !rules}
            empty="No rules yet. Add one for engine numbers or place names."
          />
          <div className="card bg-base-200 p-4 space-y-2">
            <h2 className="font-medium">Try a transcript</h2>
            <p className="text-sm text-base-content-dim">Runs active rules without sending anything.</p>
            <textarea className="textarea textarea-bordered w-full" rows={2} value={dryText} onChange={(e) => setDryText(e.target.value)} />
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || !dryText.trim()}
              onClick={() => void (async () => {
                setBusy(true);
                try {
                  const r = await dryRun({ text: dryText, systemId: 0, talkgroupId: 0 }).unwrap();
                  setDryMatched(r.matched);
                } catch (e) {
                  toast.error(message(e, "Dry run failed."));
                } finally {
                  setBusy(false);
                }
              })()}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Match
            </button>
            {dryMatched && (
              <p className="text-sm">
                {dryMatched.length === 0 ? "No matches." : `Matched: ${dryMatched.join(", ")}`}
              </p>
            )}
          </div>
        </>
      )}

      {tab === "targets" && (
        <>
          {(creatingTarget || editingTarget) && (
            <TargetForm
              key={editingTarget?.id ?? "new"}
              initial={editingTarget}
              rules={ruleRows}
              busy={busy}
              onCancel={() => { setCreatingTarget(false); setEditingTarget(null); }}
              onSave={async (values) => {
                setBusy(true);
                try {
                  if (editingTarget) {
                    await updateTarget({ id: editingTarget.id, ...values }).unwrap();
                    toast.success("Target saved.");
                  } else {
                    await createTarget(values).unwrap();
                    toast.success("Target created.");
                  }
                  setCreatingTarget(false);
                  setEditingTarget(null);
                  refetchTargets();
                } catch (e) {
                  toast.error(message(e, "Could not save the target."));
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          <DataTable
            columns={targetColumns}
            rows={targetRows}
            rowKey={(t) => t.id}
            caption="Keyword targets"
            loading={loadingTargets && !targets}
            empty="No targets yet. Add Slack or your ESP display URL."
          />
        </>
      )}
    </div>
  );
}

function RuleForm({
  initial,
  systems,
  talkgroups,
  busy,
  onCancel,
  onSave,
}: {
  initial: AdminKeywordRule | null;
  systems: AdminSystem[];
  talkgroups: AdminTalkgroup[];
  busy: boolean;
  onCancel: () => void;
  onSave: (v: {
    label: string;
    patternsJson: string;
    systemsJson: string | null;
    talkgroupsJson: string | null;
    cooldownSec: number;
    disabled: number;
    order: number;
  }) => Promise<void>;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [patterns, setPatterns] = useState(initial ? patternsLines(initial.patternsJson) : "");
  const [systemIds, setSystemIds] = useState(() => parseIds(initial?.systemsJson ?? null));
  const [tgIds, setTgIds] = useState(() => parseIds(initial?.talkgroupsJson ?? null));
  const [cooldownSec, setCooldownSec] = useState(initial?.cooldownSec ?? 120);
  const [disabled, setDisabled] = useState(!!initial?.disabled);
  const [order, setOrder] = useState(initial?.order ?? 0);

  const visibleTgs = useMemo(() => {
    if (systemIds.length === 0) return talkgroups;
    return talkgroups.filter((t) => systemIds.includes(t.systemId));
  }, [talkgroups, systemIds]);

  return (
    <form
      className="card bg-base-200 p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const list = patterns.split("\n").map((p) => p.trim()).filter(Boolean);
        void onSave({
          label: label.trim(),
          patternsJson: JSON.stringify(list),
          systemsJson: systemIds.length ? JSON.stringify(systemIds) : null,
          talkgroupsJson: tgIds.length ? JSON.stringify(tgIds) : null,
          cooldownSec,
          disabled: disabled ? 1 : 0,
          order,
        });
      }}
    >
      <h2 className="font-medium">{initial ? "Edit rule" : "New rule"}</h2>
      <label className="form-control">
        <span className="label-text">Label</span>
        <input className="input input-bordered" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={64} />
      </label>
      <label className="form-control">
        <span className="label-text">Patterns (one per line)</span>
        <textarea className="textarea textarea-bordered font-mono text-sm" rows={5} value={patterns} onChange={(e) => setPatterns(e.target.value)} required />
      </label>
      <SystemsPicker systems={systems} value={systemIds} onChange={setSystemIds} />
      <div className="fieldset">
        <span className="fieldset-legend">Talkgroups</span>
        <p className="label whitespace-normal">Pick none to match every talkgroup on the allowed systems.</p>
        <div role="group" aria-label="Talkgroups" className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
          {visibleTgs.map((t) => {
            const on = tgIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                className={`btn btn-sm ${on ? "btn-primary" : "btn-outline"}`}
                onClick={() => setTgIds(on ? tgIds.filter((x) => x !== t.id) : [...tgIds, t.id])}
              >
                {t.label || `TG ${t.talkgroupId}`}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-32">
          <span className="label-text">Cooldown (s)</span>
          <input type="number" min={0} className="input input-bordered" value={cooldownSec} onChange={(e) => setCooldownSec(Number(e.target.value) || 0)} />
        </label>
        <label className="form-control w-24">
          <span className="label-text">Order</span>
          <input type="number" className="input input-bordered" value={order} onChange={(e) => setOrder(Number(e.target.value) || 0)} />
        </label>
        <label className="label cursor-pointer gap-2 pt-8">
          <input type="checkbox" className="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
          <span className="label-text">Disabled</span>
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{initial ? "Save" : "Create"}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function TargetForm({
  initial,
  rules,
  busy,
  onCancel,
  onSave,
}: {
  initial: AdminKeywordTarget | null;
  rules: AdminKeywordRule[];
  busy: boolean;
  onCancel: () => void;
  onSave: (v: {
    label: string;
    type: KeywordTargetType;
    url: string;
    secret?: string;
    clearSecret?: boolean;
    rulesJson: string | null;
    disabled: number;
    order: number;
  }) => Promise<void>;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [type, setType] = useState<KeywordTargetType>(initial?.type ?? "slack");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [ruleIds, setRuleIds] = useState(() => parseIds(initial?.rulesJson ?? null));
  const [disabled, setDisabled] = useState(!!initial?.disabled);
  const [order, setOrder] = useState(initial?.order ?? 0);

  return (
    <form
      className="card bg-base-200 p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          label: label.trim(),
          type,
          url: url.trim(),
          secret: secret || undefined,
          clearSecret: clearSecret || undefined,
          rulesJson: ruleIds.length ? JSON.stringify(ruleIds) : null,
          disabled: disabled ? 1 : 0,
          order,
        });
      }}
    >
      <h2 className="font-medium">{initial ? "Edit target" : "New target"}</h2>
      <label className="form-control">
        <span className="label-text">Label</span>
        <input className="input input-bordered" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={64} />
      </label>
      <label className="form-control">
        <span className="label-text">Type</span>
        <select className="select select-bordered" value={type} onChange={(e) => setType(e.target.value as KeywordTargetType)}>
          <option value="slack">Slack</option>
          <option value="display">Display (ESP)</option>
          <option value="generic">Generic JSON</option>
        </select>
      </label>
      <label className="form-control">
        <span className="label-text">URL</span>
        <input className="input input-bordered" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
      </label>
      <label className="form-control">
        <span className="label-text">Secret / token{initial?.hasSecret ? " (set)" : ""}</span>
        <input className="input input-bordered" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" placeholder={initial?.hasSecret ? "Leave blank to keep" : ""} />
      </label>
      {initial?.hasSecret && (
        <label className="label cursor-pointer gap-2 justify-start">
          <input type="checkbox" className="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} />
          <span className="label-text">Clear secret</span>
        </label>
      )}
      <div className="fieldset">
        <span className="fieldset-legend">Rules</span>
        <p className="label whitespace-normal">Pick none to receive every rule.</p>
        <div role="group" aria-label="Rules" className="flex flex-wrap gap-2">
          {rules.map((r) => {
            const on = ruleIds.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                className={`btn btn-sm ${on ? "btn-primary" : "btn-outline"}`}
                onClick={() => setRuleIds(on ? ruleIds.filter((x) => x !== r.id) : [...ruleIds, r.id])}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-24">
          <span className="label-text">Order</span>
          <input type="number" className="input input-bordered" value={order} onChange={(e) => setOrder(Number(e.target.value) || 0)} />
        </label>
        <label className="label cursor-pointer gap-2 pt-8">
          <input type="checkbox" className="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
          <span className="label-text">Disabled</span>
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{initial ? "Save" : "Create"}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
