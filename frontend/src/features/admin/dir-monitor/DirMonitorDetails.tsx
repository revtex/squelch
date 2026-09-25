import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, Pencil, RotateCw, ScrollText, Trash2 } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  FactList,
  InlineConfirm,
  PanelSection,
  formatAgo,
  formatDateTime,
  type Fact,
} from "@/features/admin/_shell";
import type { AdminDirMonitor, AdminSystem, AdminTalkgroup, MonitorStatus } from "@/types";
import { destinationLabel, fileName, recorderType, stateBadge, waitLabel } from "./monitors";

export type MonitorAction = "disable" | "enable" | "delete";

export interface DirMonitorDetailsProps {
  monitor: AdminDirMonitor;
  systems: AdminSystem[];
  talkgroups: AdminTalkgroup[];
  busy: boolean;
  onEdit: () => void;
  /** Restarts the monitor; resolves to its new status. */
  onRestart: () => Promise<MonitorStatus>;
  /** Resolves to the error message, or null when it worked. */
  onAction: (action: MonitorAction) => Promise<string | null>;
  onClose: () => void;
}

function question(action: MonitorAction, m: AdminDirMonitor) {
  switch (action) {
    case "disable":
      return {
        title: `Stop watching ${m.directory}?`,
        text: "Files that arrive while it is disabled are picked up when you enable it again, if they are still there.",
        button: "Disable",
        danger: false,
      };
    case "enable":
      return {
        title: `Watch ${m.directory} again?`,
        text: "The monitor starts at once.",
        button: "Enable",
        danger: false,
      };
    case "delete":
      return {
        title: `Delete the monitor for ${m.directory}?`,
        text: "Calls it already imported are kept. The folder itself is not touched. This cannot be undone.",
        button: "Delete",
        danger: true,
      };
  }
}

/** Everything about one folder monitor and what an admin can do about it. */
export default function DirMonitorDetails({
  monitor: m,
  systems,
  talkgroups,
  busy,
  onEdit,
  onRestart,
  onAction,
  onClose,
}: DirMonitorDetailsProps) {
  const [pending, setPending] = useState<MonitorAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartNote, setRestartNote] = useState<{ ok: boolean; text: string } | null>(null);
  const badge = stateBadge(m);
  const type = recorderType(m.type);
  const s = m.status;

  const run = async (action: MonitorAction) => {
    setError(null);
    const failed = await onAction(action);
    setPending(null);
    if (failed !== null) setError(failed);
    else if (action === "delete") onClose();
  };

  const restart = async () => {
    setRestarting(true);
    setRestartNote(null);
    try {
      const st = await onRestart();
      setRestartNote(
        st.state === "stopped"
          ? { ok: false, text: `Still stopped: ${st.error || "no reason given"}.` }
          : { ok: true, text: `Restarted, now ${st.state}.` },
      );
    } catch (e) {
      setRestartNote({
        ok: false,
        text: e instanceof Error && e.message ? e.message : "The restart did not work.",
      });
    } finally {
      setRestarting(false);
    }
  };

  const facts: Fact[] = [
    { label: "Folder", value: <span className="font-mono break-all">{m.directory}</span> },
    { label: "Recorder", value: type.label },
    { label: "Files", value: m.extension ? `.${m.extension} only` : "Any file" },
    ...(m.mask ? [{ label: "Mask", value: <span className="font-mono">{m.mask}</span> }] : []),
    { label: "Calls go to", value: destinationLabel(m, systems, talkgroups) },
    { label: "Reads", value: waitLabel(m) },
    {
      label: "After import",
      value: m.deleteAfter === 1 ? "The file is deleted" : "The file is left in place",
    },
    {
      label: "State",
      value: s.since ? `${badge.label}, since ${formatAgo(s.since)}` : badge.label,
    },
    {
      label: "Last file",
      value: s.lastFileAt ? (
        <span>
          <span className="font-mono">{fileName(s.lastFile)}</span>, {formatAgo(s.lastFileAt)}
          {s.lastResult && <span className="block text-xs text-base-content/70">{s.lastResult}</span>}
        </span>
      ) : (
        "None yet"
      ),
    },
    { label: "Calls, 24 h", value: s.ingested24h.toLocaleString() },
  ];

  const ask = pending ? question(pending, m) : null;

  return (
    <DetailsPanel
      title={m.directory}
      titleClassName="font-mono break-all"
      subtitle="Folder monitor"
      badges={<span className={`badge badge-sm ${badge.badge}`}>{badge.label}</span>}
      onClose={onClose}
    >
      <FactList facts={facts} />

      {s.state === "stopped" && s.error && (
        <div className="alert alert-error text-sm">
          <span>
            The monitor stopped: {s.error}. Fix the folder or its permissions, then restart it.
          </span>
        </div>
      )}
      {(s.state === "watching" || s.state === "polling") && s.error && (
        <div className="alert alert-warning text-sm">
          <span>Still running, but the last attempt hit a problem: {s.error}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="alert alert-error text-sm">
          {error}
        </div>
      )}

      {ask && pending ? (
        <InlineConfirm
          title={ask.title}
          text={ask.text}
          button={ask.button}
          danger={ask.danger}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void run(pending)}
        />
      ) : (
        <>
          <PanelSection title="Monitor">
            <ActionButton
              icon={<Pencil className="h-4 w-4" />}
              label="Edit"
              hint="Folder, recorder, mask, where calls go."
              onClick={onEdit}
            />
            {m.disabled === 0 && (
              <ActionButton
                icon={<RotateCw className="h-4 w-4" />}
                label={restarting ? "Restarting…" : "Restart"}
                hint="Stops and starts the monitor, e.g. after the folder came back."
                disabled={restarting || busy}
                onClick={() => void restart()}
              />
            )}
            {restartNote && (
              <div
                role={restartNote.ok ? "status" : "alert"}
                className={`alert text-sm ${restartNote.ok ? "alert-success" : "alert-error"}`}
              >
                {restartNote.text}
              </div>
            )}
            <Link
              to={`/admin/logs?q=${encodeURIComponent(m.directory)}`}
              className="btn btn-ghost btn-sm justify-start gap-2"
            >
              <ScrollText className="h-4 w-4" aria-hidden="true" />
              Show this monitor's log lines
            </Link>
          </PanelSection>

          <PanelSection title="Danger zone">
            {m.disabled === 1 ? (
              <ActionButton
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Enable"
                hint="Start watching the folder again."
                onClick={() => setPending("enable")}
              />
            ) : (
              <ActionButton
                icon={<Ban className="h-4 w-4" />}
                label="Disable"
                hint="Stop watching without deleting the monitor."
                onClick={() => setPending("disable")}
              />
            )}
            <ActionButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete"
              hint="Removes the monitor. Imported calls and the folder stay."
              danger
              onClick={() => setPending("delete")}
            />
          </PanelSection>
        </>
      )}
      {s.since !== null && s.state !== "disabled" && (
        <p className="text-xs text-base-content/60">
          In this state since {formatDateTime(s.since)}.
        </p>
      )}
    </DetailsPanel>
  );
}
