import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeft, FolderOpen } from "lucide-react";
import {
  DetailsPanel,
  Field,
  SwitchRow,
  useLazyListServerDirectoriesQuery,
  useNavigationGuard,
  useTestMaskMutation,
} from "@/features/admin/_shell";
import type { AdminDirMonitor, AdminSystem, AdminTalkgroup, MaskTestResult } from "@/types";
import { MASK_TOKENS, RECORDER_TYPES, recorderType } from "./monitors";

export interface DirMonitorFormValues {
  directory: string;
  type: string;
  mask: string | null;
  extension: string | null;
  frequency: number | null;
  delay: number | null;
  deleteAfter: number;
  usePolling: number;
  disabled: number;
  systemId: number | null;
  talkgroupId: number | null;
}

interface FormState {
  directory: string;
  type: string;
  mask: string;
  extension: string;
  frequency: string;
  /** Seconds, as typed. */
  wait: string;
  deleteAfter: boolean;
  usePolling: boolean;
  enabled: boolean;
  systemId: string;
  talkgroupId: string;
}

function fromMonitor(m: AdminDirMonitor | null): FormState {
  return {
    directory: m?.directory ?? "",
    type: m?.type ?? "trunk-recorder",
    mask: m?.mask ?? "",
    extension: m?.extension ?? "",
    frequency: m?.frequency != null ? String(m.frequency) : "",
    wait: m?.delay != null ? String(m.delay / 1000) : "",
    deleteAfter: m ? m.deleteAfter === 1 : false,
    usePolling: m ? m.usePolling === 1 : true,
    enabled: m ? m.disabled === 0 : true,
    systemId: m?.systemId != null ? String(m.systemId) : "",
    talkgroupId: m?.talkgroupId != null ? String(m.talkgroupId) : "",
  };
}

export interface DirMonitorFormProps {
  monitor: AdminDirMonitor | null;
  systems: AdminSystem[];
  talkgroups: AdminTalkgroup[];
  busy: boolean;
  error: string | null;
  onSubmit: (values: DirMonitorFormValues) => void;
  onClose: () => void;
}

/** Create or edit a folder monitor, with a folder browser and a mask tester. */
export default function DirMonitorForm({
  monitor,
  systems,
  talkgroups,
  busy,
  error,
  onSubmit,
  onClose,
}: DirMonitorFormProps) {
  const id = useId();
  const [form, setForm] = useState<FormState>(() => fromMonitor(monitor));
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState<"form" | "browse">("form");
  const { setGuard } = useNavigationGuard();
  const creating = monitor === null;
  const type = recorderType(form.type);

  useEffect(() => {
    setGuard(dirty ? () => true : null);
    return () => setGuard(null);
  }, [dirty, setGuard]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const talkgroupsForSystem = useMemo(
    () =>
      form.systemId
        ? talkgroups
            .filter((t) => t.systemId === Number(form.systemId))
            .sort((a, b) => a.order - b.order)
        : [],
    [talkgroups, form.systemId],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setDirty(false);
    const waitSecs = form.wait ? Number(form.wait) : NaN;
    onSubmit({
      directory: form.directory.trim(),
      type: form.type,
      mask: type.fields.mask && form.mask.trim() ? form.mask.trim() : null,
      extension: type.fields.extension && form.extension.trim() ? form.extension.trim() : null,
      frequency: type.fields.frequency && form.frequency ? Number(form.frequency) : null,
      delay: Number.isFinite(waitSecs) && waitSecs > 0 ? Math.round(waitSecs * 1000) : null,
      deleteAfter: form.deleteAfter ? 1 : 0,
      usePolling: form.usePolling ? 1 : 0,
      disabled: form.enabled ? 0 : 1,
      systemId: type.fields.destination && form.systemId ? Number(form.systemId) : null,
      talkgroupId:
        type.fields.destination && form.systemId && form.talkgroupId
          ? Number(form.talkgroupId)
          : null,
    });
  };

  const formId = `${id}-form`;

  if (step === "browse") {
    return (
      <FolderBrowser
        start={form.directory}
        onPick={(path) => {
          set("directory", path);
          setStep("form");
        }}
        onBack={() => setStep("form")}
        onClose={onClose}
      />
    );
  }

  return (
    <DetailsPanel
      title={creating ? "New folder monitor" : `Edit ${monitor.directory}`}
      titleClassName={creating ? undefined : "font-mono break-all"}
      subtitle={
        creating
          ? "Watch a folder on the server and import the recordings that land in it."
          : "Saving restarts the monitor."
      }
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy && <span className="loading loading-spinner loading-xs" />}
            {creating ? "Add monitor" : "Save"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="alert alert-error text-sm">
            {error}
          </div>
        )}

        <Field htmlFor={`${id}-type`} label="Recorder" hint={type.hint}>
          <select
            id={`${id}-type`}
            className="select w-full"
            value={form.type}
            onChange={(e) => {
              set("type", e.target.value);
              set("systemId", "");
              set("talkgroupId", "");
            }}
          >
            {RECORDER_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          htmlFor={`${id}-dir`}
          label="Folder"
          hint="An absolute path on the server the recorder writes into."
        >
          <div className="join w-full">
            <input
              id={`${id}-dir`}
              type="text"
              className="input join-item w-full font-mono text-sm"
              value={form.directory}
              placeholder="/recordings"
              onChange={(e) => set("directory", e.target.value)}
              required
              autoFocus={creating}
            />
            <button
              type="button"
              className="btn join-item"
              onClick={() => setStep("browse")}
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              Browse
            </button>
          </div>
        </Field>

        {type.fields.extension && (
          <Field
            htmlFor={`${id}-ext`}
            label="Only files ending in"
            hint="Without the dot, e.g. wav or mp3. Leave empty to consider every file."
          >
            <input
              id={`${id}-ext`}
              type="text"
              className="input w-full font-mono"
              value={form.extension}
              placeholder={form.type === "trunk-recorder" ? "json" : "wav"}
              onChange={(e) => set("extension", e.target.value.replace(/^\./, ""))}
            />
          </Field>
        )}

        {type.fields.destination && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              htmlFor={`${id}-sys`}
              label="Send every call to system"
              hint="Leave on “read from the files” when the filenames say which system."
            >
              <select
                id={`${id}-sys`}
                className="select w-full"
                value={form.systemId}
                onChange={(e) => {
                  set("systemId", e.target.value);
                  set("talkgroupId", "");
                }}
              >
                <option value="">Read from the files</option>
                {systems
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              htmlFor={`${id}-tg`}
              label="…and talkgroup"
              hint={form.systemId ? "Optional." : "Pick a system first."}
            >
              <select
                id={`${id}-tg`}
                className="select w-full"
                value={form.talkgroupId}
                disabled={!form.systemId}
                onChange={(e) => set("talkgroupId", e.target.value)}
              >
                <option value="">Read from the files</option>
                {talkgroupsForSystem.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.label ?? t.talkgroupId} ({t.talkgroupId})
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {type.fields.mask && (
          <MaskField id={`${id}-mask`} value={form.mask} onChange={(v) => set("mask", v)} />
        )}

        {type.fields.frequency && (
          <Field
            htmlFor={`${id}-freq`}
            label="Frequency, Hz"
            hint="Shown with the calls when the files do not say. Optional."
          >
            <input
              id={`${id}-freq`}
              type="number"
              min={0}
              className="input w-full"
              value={form.frequency}
              placeholder="155325000"
              onChange={(e) => set("frequency", e.target.value)}
            />
          </Field>
        )}

        <Field
          htmlFor={`${id}-wait`}
          label="Wait before ingest, seconds"
          hint={
            form.usePolling
              ? "How often the folder is scanned. Empty means every 2 seconds; never less than 0.5."
              : "How long a file must sit unchanged before it is read, so the recorder can finish writing. Empty means 2 seconds, which is also the least."
          }
        >
          <input
            id={`${id}-wait`}
            type="number"
            min={form.usePolling ? 0.5 : 2}
            step={0.5}
            className="input w-full"
            value={form.wait}
            placeholder="2"
            onChange={(e) => set("wait", e.target.value)}
          />
        </Field>

        <SwitchRow
          id={`${id}-poll`}
          label="Poll instead of watching"
          hint="Scan the folder on a timer. Needed for network shares (NFS, CIFS/SMB) and other mounts that do not report new files."
          checked={form.usePolling}
          onChange={(v) => set("usePolling", v)}
        />
        <SwitchRow
          id={`${id}-delete`}
          label="Delete the file after import"
          hint="Squelch keeps its own copy of the audio, so the original can go."
          checked={form.deleteAfter}
          onChange={(v) => set("deleteAfter", v)}
        />
        <SwitchRow
          id={`${id}-enabled`}
          label="Enabled"
          hint="Turn off to stop watching without deleting the monitor."
          checked={form.enabled}
          onChange={(v) => set("enabled", v)}
        />
      </form>
    </DetailsPanel>
  );
}

interface MaskFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

/** The filename mask, with a tester that parses an example name as you type. */
function MaskField({ id, value, onChange }: MaskFieldProps) {
  const [example, setExample] = useState("");
  const [tested, setTested] = useState<{ mask: string; filename: string; result: MaskTestResult } | null>(null);
  const [testMask] = useTestMaskMutation();
  const mask = value.trim();
  const filename = example.trim();

  useEffect(() => {
    if (!mask || !filename) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      testMask({ mask, filename })
        .unwrap()
        .then((result) => {
          if (!cancelled) setTested({ mask, filename, result });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mask, filename, testMask]);

  // Only show a result that belongs to what is typed now.
  const result =
    tested && tested.mask === mask && tested.filename === filename ? tested.result : null;

  const found = result ? Object.entries(result.values).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div className="space-y-2 rounded-box border border-admin-line p-3">
      <Field
        htmlFor={id}
        label="Filename mask"
        hint="Tokens for the parts of the name that carry the call's details; everything else must match exactly."
      >
        <input
          id={id}
          type="text"
          className="input w-full font-mono text-sm"
          value={value}
          placeholder="#DATE_#TIME_#SYS_#TG"
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      <Field
        htmlFor={`${id}-example`}
        label="Try it on a filename"
        hint="Paste a real filename from the folder to see what the mask reads from it."
      >
        <input
          id={`${id}-example`}
          type="text"
          className="input w-full font-mono text-sm"
          value={example}
          placeholder="2025-01-15_143022_101_5200.wav"
          onChange={(e) => setExample(e.target.value)}
        />
      </Field>
      {result && (
        <div
          role="status"
          className={`text-sm ${result.ok ? "text-success" : "text-error"}`}
        >
          {result.ok ? (
            <span>
              Matches.{" "}
              {found.map(([token, v]) => (
                <span key={token} className="mr-2 inline-block">
                  <span className="font-mono">{token}</span> = {v}{" "}
                </span>
              ))}
            </span>
          ) : (
            "The mask does not match that name."
          )}
        </div>
      )}
      <details>
        <summary className="cursor-pointer select-none text-xs text-base-content-dim">
          Tokens the mask understands
        </summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {MASK_TOKENS.map((t) => (
            <div key={t.token} className="contents">
              <dt className="font-mono">{t.token}</dt>
              <dd className="text-base-content-dim">{t.means}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

interface FolderBrowserProps {
  start: string;
  onPick: (path: string) => void;
  onBack: () => void;
  onClose: () => void;
}

/** A step inside the form panel: walk the server's folders and pick one. */
function FolderBrowser({ start, onPick, onBack, onClose }: FolderBrowserProps) {
  const id = useId();
  const [load, { data, isFetching }] = useLazyListServerDirectoriesQuery();
  const [jump, setJump] = useState(start.startsWith("/") ? start : "/");
  const [problem, setProblem] = useState<string | null>(null);

  const go = (path: string) => {
    const target = path.trim() === "" ? "/" : path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`;
    setJump(target);
    setProblem(null);
    load({ path: target })
      .unwrap()
      .catch((e: unknown) => {
        setProblem(e instanceof Error && e.message ? e.message : "That folder could not be read.");
      });
  };

  useEffect(() => {
    go(start.startsWith("/") ? start : "/");
    // Only on first show; later moves come from the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const here = data?.path ?? jump;

  return (
    <DetailsPanel
      title="Pick a folder"
      subtitle="Folders on the server, as the Squelch process sees them."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to the form
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!data || isFetching}
            onClick={() => onPick(here)}
          >
            Use this folder
          </button>
        </>
      }
    >
      <form
        className="join w-full"
        onSubmit={(e) => {
          e.preventDefault();
          go(jump);
        }}
      >
        <input
          id={`${id}-jump`}
          aria-label="Folder path"
          type="text"
          className="input join-item w-full font-mono text-sm"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
        />
        <button type="submit" className="btn join-item" disabled={isFetching}>
          Go
        </button>
      </form>
      {problem && (
        <div role="alert" className="alert alert-error text-sm">
          {problem}
        </div>
      )}
      <p className="font-mono text-sm break-all" aria-live="polite">
        {here}
      </p>
      <ul className="menu max-h-80 w-full overflow-auto rounded-box border border-admin-line p-0">
        {data?.parent && (
          <li>
            <button type="button" onClick={() => go(data.parent!)} disabled={isFetching}>
              ‹ Up one level
            </button>
          </li>
        )}
        {(data?.directories ?? []).map((d) => (
          <li key={d.path}>
            <button
              type="button"
              className="font-mono"
              onClick={() => go(d.path)}
              disabled={isFetching}
            >
              {d.name}
            </button>
          </li>
        ))}
        {data && data.directories.length === 0 && (
          <li className="p-3 text-sm text-base-content-dim">No folders inside this one.</li>
        )}
      </ul>
    </DetailsPanel>
  );
}
