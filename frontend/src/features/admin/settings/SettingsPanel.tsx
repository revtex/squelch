import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import {
  PageHeader,
  SearchBox,
  Segmented,
  SwitchRow,
  formatBytes,
  formatDate,
  formatAgo,
  plural,
  useGetConfigQuery,
  useNavigationGuard,
  useToast,
  useUpdateConfigMutation,
} from "@/features/admin/_shell";
import type { AdminSetting, Capabilities, StorageInfo } from "@/types";
import {
  GROUPS,
  HE_AAC_PRESETS,
  changedRows,
  currentValue,
  matchesSearch,
  rowEnabled,
  serverValues,
  validate,
  type SettingGroup,
  type SettingRow,
} from "./settings";

/** Server-wide settings in named groups, saved together from the bar at the bottom. */
export default function SettingsPanel() {
  const { data: config, isLoading } = useGetConfigQuery();
  const [updateConfig, { isLoading: saving }] = useUpdateConfigMutation();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  // A search result on this same page changes ?q= without remounting.
  const qParam = searchParams.get("q");
  const [seenQ, setSeenQ] = useState(qParam);
  if (qParam !== seenQ) {
    setSeenQ(qParam);
    if (qParam !== null) setQuery(qParam);
  }
  // Only the keys the admin has touched; everything else reads from the server.
  const [draft, setDraft] = useState<Record<string, string>>({});

  const server = useMemo(() => serverValues(config?.settings), [config?.settings]);
  const capabilities = config?.capabilities;
  const changed = useMemo(() => changedRows(server, draft), [server, draft]);
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of changed) {
      const msg = validate(row, draft[row.key] ?? "");
      if (msg) out[row.key] = msg;
    }
    return out;
  }, [changed, draft]);
  const dirty = changed.length > 0;

  // Leaving the page with unsaved changes asks first.
  const { setGuard } = useNavigationGuard();
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    setGuard(() => dirtyRef.current);
    return () => setGuard(null);
  }, [setGuard]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const setValue = useCallback((key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const applyAtOnce = useCallback(
    async (row: SettingRow, value: string) => {
      try {
        await updateConfig([{ key: row.key, value }]).unwrap();
        toast.success(
          row.key === "logLevel"
            ? `The server now logs at ${value}. This applies at once.`
            : `${row.label} saved.`,
        );
      } catch (e) {
        toast.error(e instanceof Error && e.message ? e.message : `Could not save ${row.label}.`);
      }
    },
    [updateConfig, toast],
  );

  const save = useCallback(async () => {
    if (!dirty || Object.keys(errors).length > 0) return;
    const settings: AdminSetting[] = changed.map((r) => ({ key: r.key, value: (draft[r.key] ?? "").trim() }));
    try {
      await updateConfig(settings).unwrap();
      setDraft({});
      toast.success(`Saved ${plural(settings.length, "setting")}.`);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "The settings could not be saved.");
    }
  }, [dirty, errors, changed, draft, updateConfig, toast]);

  const visibleGroups = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, rows: g.rows.filter((r) => matchesSearch(r, g, query)) })).filter(
        (g) => g.rows.length > 0,
      ),
    [query],
  );

  if (isLoading && !config) {
    return (
      <div className="flex justify-center py-12" role="status" aria-label="Loading settings">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-[18px] pb-24">
      <PageHeader
        title="Settings"
        subtitle="Server-wide options. Nothing applies until you save, except where a row says otherwise."
        actions={<SearchBox value={query} onChange={setQuery} label="Find a setting" className="w-full sm:w-64" />}
      />

      <nav
        aria-label="Setting groups"
        className="sticky top-12 z-10 -mx-1 flex gap-1 overflow-x-auto bg-base-100/95 px-1 py-2 backdrop-blur"
      >
        {visibleGroups.map((g) => (
          <a key={g.id} href={`#settings-${g.id}`} className="btn btn-ghost btn-xs whitespace-nowrap">
            {g.title}
          </a>
        ))}
      </nav>

      {visibleGroups.length === 0 && <p className="text-sm text-base-content-dim">No setting matches.</p>}

      {visibleGroups.map((group) => (
        <section
          key={group.id}
          id={`settings-${group.id}`}
          aria-labelledby={`settings-${group.id}-title`}
          className="scroll-mt-28 space-y-3"
        >
          <div>
            <h3 id={`settings-${group.id}-title`} className="text-base font-semibold">
              {group.title}
            </h3>
            {group.hint && <p className="text-xs text-base-content-dim">{group.hint}</p>}
            {group.id === "storage" && <StorageLine storage={config?.storage} />}
          </div>
          <div className="divide-y divide-admin-line rounded-box border border-admin-line bg-base-200">
            {group.rows.map((row) => (
              <SettingRowView
                key={row.key}
                row={row}
                group={group}
                value={currentValue(row, server, draft)}
                serverValue={server[row.key] ?? row.fallback}
                enabled={rowEnabled(row, server, draft, capabilities)}
                changed={changed.includes(row)}
                error={errors[row.key] ?? null}
                capabilities={capabilities}
                onChange={(v) => (row.applyAtOnce ? void applyAtOnce(row, v) : setValue(row.key, v))}
              />
            ))}
            {group.id === "access" && <TrustedAddresses addresses={config?.trustedAddresses ?? []} />}
            {group.id === "integrations" && (
              <>
                <LinkRow to="/admin/trunk-recorder" label="Trunk Recorder" hint="Brokers, instances and the live dashboard." />
                <LinkRow to="/admin/transcription" label="Transcription" hint="Has its own page with connection status and models." />
              </>
            )}
          </div>
        </section>
      ))}

      <div
        role="region"
        aria-label="Unsaved changes"
        className="fixed inset-x-0 bottom-16 z-20 border-t border-admin-line bg-base-100/95 px-3 py-2 backdrop-blur md:bottom-0 md:left-19 lg:left-58"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm">
            {dirty ? (
              <>
                <span className="font-medium">Changed:</span> {changed.map((r) => r.label).join(", ")}
                {Object.keys(errors).length > 0 && (
                  <span className="text-error"> · {plural(Object.keys(errors).length, "value needs", "values need")} fixing</span>
                )}
              </>
            ) : (
              <span className="text-base-content-dim">No unsaved changes</span>
            )}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty || saving} onClick={() => setDraft({})}>
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!dirty || saving || Object.keys(errors).length > 0}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  row: SettingRow;
  group: SettingGroup;
  value: string;
  serverValue: string;
  enabled: boolean;
  changed: boolean;
  error: string | null;
  capabilities: Capabilities | undefined;
  onChange: (value: string) => void;
}

function SettingRowView({ row, value, enabled, changed, error, capabilities, onChange }: RowProps) {
  const id = `setting-${row.key}`;
  const indent = row.dependsOn ? "pl-7" : "";
  const badge = changed && <span className="badge badge-warning badge-sm">Changed</span>;
  const perUser = row.perUser && <span className="badge badge-ghost badge-sm">per user</span>;

  if (row.kind === "switch") {
    const on = row.invert ? value !== "true" : value === "true";
    return (
      <div className={`p-3 ${indent}`}>
        <SwitchRow
          id={id}
          label={row.label}
          hint={
            <>
              {row.hint} {badge}
            </>
          }
          checked={on}
          disabled={!enabled}
          onChange={(next) => onChange(row.invert ? (next ? "false" : "true") : next ? "true" : "false")}
        />
      </div>
    );
  }

  let control: React.ReactNode;
  if (row.kind === "choice") {
    const choices = (row.choices ?? []).filter((c) => row.key !== "audioEncodingPreset" || capabilities?.fdkAac || !HE_AAC_PRESETS.has(c.id));
    control =
      choices.length <= 4 ? (
        <Segmented label={row.label} options={choices} value={value} disabled={!enabled} onChange={onChange} />
      ) : (
        <select id={id} className="select select-sm" value={value} disabled={!enabled} onChange={(e) => onChange(e.target.value)}>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      );
  } else {
    control = (
      <span className="flex items-center gap-2">
        <input
          id={id}
          type={row.kind === "number" ? "number" : row.kind === "email" ? "email" : "text"}
          inputMode={row.kind === "number" ? "numeric" : undefined}
          className={`input input-sm ${row.kind === "number" ? "w-28" : "w-full sm:w-64"} ${error ? "input-error" : ""}`}
          value={value}
          min={row.kind === "number" ? row.min : undefined}
          max={row.kind === "number" ? row.max : undefined}
          maxLength={row.kind === "text" ? row.max : undefined}
          disabled={!enabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {row.unit && <span className="text-sm text-base-content-dim">{row.unit}</span>}
      </span>
    );
  }

  const labelled = row.kind === "choice" && (row.choices ?? []).length <= 4;
  return (
    <div className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 ${indent} ${enabled ? "" : "opacity-60"}`}>
      <div className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          {labelled ? (
            <span className="font-medium">{row.label}</span>
          ) : (
            <label htmlFor={id} className="font-medium">
              {row.label}
            </label>
          )}
          {perUser}
          {badge}
        </span>
        <p className="text-xs text-base-content-dim">{row.hint}</p>
        {!enabled && capabilities && !capabilities.ffmpeg && row.key === "audioConversion" && (
          <p className="text-xs text-warning">FFmpeg is not installed on the server, so audio is stored as uploaded.</p>
        )}
        {error && (
          <p id={`${id}-error`} role="alert" className="text-xs text-error">
            {error}
          </p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function StorageLine({ storage }: { storage: StorageInfo | undefined }) {
  if (!storage) return null;
  const parts: string[] = [];
  if (storage.measuredAt === 0) parts.push("Measuring the recordings folder…");
  else parts.push(`${formatBytes(storage.recordingsBytes)} of recordings in ${plural(storage.recordingFiles, "file")}.`);
  if (storage.volumeTotalBytes > 0) {
    parts.push(`Volume ${formatBytes(storage.volumeTotalBytes)}, ${formatBytes(storage.volumeFreeBytes)} free.`);
  }
  if (storage.databaseBytes > 0) parts.push(`Database ${formatBytes(storage.databaseBytes)}.`);
  if (storage.oldestCall) parts.push(`Oldest call ${formatDate(storage.oldestCall)}, ${formatAgo(storage.oldestCall)}.`);
  return (
    <p className="text-xs text-base-content-dim" data-testid="storage-line">
      {parts.join(" ")}
    </p>
  );
}

function TrustedAddresses({ addresses }: { addresses: string[] }) {
  return (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <span className="block font-medium">Trusted addresses</span>
        <p className="text-xs text-base-content-dim">
          Set on the server with <code>--trusted-addresses</code> or <code>SQUELCH_TRUSTED_ADDRESSES</code>; never blockable from Connections. The server itself is always trusted.
        </p>
      </div>
      <div className="shrink-0 font-mono text-sm">
        {addresses.length === 0 ? <span className="text-base-content-dim">None besides localhost</span> : addresses.join(", ")}
      </div>
    </div>
  );
}

function LinkRow({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <span className="block font-medium">{label}</span>
        <p className="text-xs text-base-content-dim">{hint}</p>
      </div>
      <Link to={to} className="btn btn-ghost btn-sm gap-2">
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        Open {label}
      </Link>
    </div>
  );
}
