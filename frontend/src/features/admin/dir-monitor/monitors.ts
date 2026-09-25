import type { AdminDirMonitor, AdminSystem, AdminTalkgroup, MonitorState } from "@/types";

export type StatusFilter = "all" | "running" | "stopped" | "disabled";

export interface RecorderType {
  id: string;
  label: string;
  /** One line on what the recorder writes and how the monitor reads it. */
  hint: string;
  /** Which optional fields make sense for this recorder. */
  fields: {
    extension: boolean;
    destination: boolean;
    mask: boolean;
    frequency: boolean;
  };
}

export const RECORDER_TYPES: readonly RecorderType[] = [
  {
    id: "trunk-recorder",
    label: "Trunk Recorder",
    hint: "Reads the JSON file Trunk Recorder writes next to each audio file.",
    fields: { extension: true, destination: false, mask: false, frequency: false },
  },
  {
    id: "sdr-trunk",
    label: "SDRTrunk",
    hint: "Reads the tags SDRTrunk stores inside its MP3 files.",
    fields: { extension: false, destination: false, mask: false, frequency: false },
  },
  {
    id: "dsdplus",
    label: "DSD+ Fast Lane",
    hint: "Reads system and talkgroup from the DSD+ filename.",
    fields: { extension: true, destination: true, mask: false, frequency: false },
  },
  {
    id: "proscan",
    label: "ProScan",
    hint: "Reads the ProScan filename; a mask can fill in what it lacks.",
    fields: { extension: true, destination: true, mask: true, frequency: false },
  },
  {
    id: "rtlsdr-airband",
    label: "RTLSDR-Airband",
    hint: "Conventional recordings; the system and frequency come from this monitor.",
    fields: { extension: true, destination: true, mask: false, frequency: true },
  },
  {
    id: "default",
    label: "Other (filename mask)",
    hint: "Any recorder: a mask says which parts of the filename are the date, system and talkgroup.",
    fields: { extension: true, destination: true, mask: true, frequency: true },
  },
];

export function recorderType(id: string): RecorderType {
  return RECORDER_TYPES.find((t) => t.id === id) ?? RECORDER_TYPES[RECORDER_TYPES.length - 1];
}

export const MASK_TOKENS: readonly { token: string; means: string }[] = [
  { token: "#DATE", means: "date: 20201231, 2020-12-31 or 2020_12_31" },
  { token: "#TIME", means: "local time: 085430, 08-54-30 or 08:54:30" },
  { token: "#ZTIME", means: "UTC time" },
  { token: "#SYS", means: "system id" },
  { token: "#SYSLBL", means: "system label" },
  { token: "#TG", means: "talkgroup id" },
  { token: "#TGLBL", means: "talkgroup label" },
  { token: "#TGAFS", means: "talkgroup in AFS form, e.g. 11-061" },
  { token: "#HZ, #KHZ, #MHZ", means: "frequency" },
  { token: "#TGHZ, #TGKHZ, #TGMHZ", means: "frequency used as the talkgroup id" },
  { token: "#GROUP", means: "group label" },
  { token: "#TAG", means: "tag label" },
  { token: "#UNIT", means: "unit id" },
];

export interface StateBadge {
  id: MonitorState;
  label: string;
  badge: string;
}

export function stateBadge(m: AdminDirMonitor): StateBadge {
  const s = m.status;
  switch (s.state) {
    case "watching":
      return { id: "watching", label: s.error ? "watching, with trouble" : "watching", badge: s.error ? "badge-warning" : "badge-success" };
    case "polling":
      return { id: "polling", label: s.error ? "polling, with trouble" : "polling", badge: s.error ? "badge-warning" : "badge-success" };
    case "stopped":
      return { id: "stopped", label: "stopped", badge: "badge-error" };
    case "disabled":
      return { id: "disabled", label: "disabled", badge: "badge-ghost" };
    default:
      return { id: "unknown", label: "unknown", badge: "badge-ghost" };
  }
}

export function matchesFilter(m: AdminDirMonitor, f: StatusFilter): boolean {
  const s = m.status.state;
  switch (f) {
    case "all":
      return true;
    case "running":
      return s === "watching" || s === "polling";
    case "stopped":
      return s === "stopped";
    case "disabled":
      return s === "disabled";
  }
}

/** Where a monitor's calls end up: fixed overrides, or read from the files. */
export function destinationLabel(
  m: AdminDirMonitor,
  systems: AdminSystem[],
  talkgroups: AdminTalkgroup[],
): string {
  if (m.systemId === null) return "Read from the files";
  const sys = systems.find((s) => s.id === m.systemId);
  const sysName = sys ? sys.label : `system #${m.systemId}`;
  if (m.talkgroupId === null) return sysName;
  const tg = talkgroups.find((t) => t.id === m.talkgroupId);
  const tgName = tg ? (tg.label ?? String(tg.talkgroupId)) : `talkgroup #${m.talkgroupId}`;
  return `${sysName} › ${tgName}`;
}

export function matchesSearch(
  m: AdminDirMonitor,
  systems: AdminSystem[],
  talkgroups: AdminTalkgroup[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [m.directory, recorderType(m.type).label, destinationLabel(m, systems, talkgroups)].some(
    (v) => v.toLowerCase().includes(q),
  );
}

export function fileName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/** The wait in words: "2 s", or the default when unset. */
export function waitLabel(m: AdminDirMonitor): string {
  if (m.delay === null) return m.usePolling === 1 ? "every 2 s (default)" : "2 s after the last write (default)";
  const secs = m.delay / 1000;
  const shown = Number.isInteger(secs) ? String(secs) : secs.toFixed(1);
  return m.usePolling === 1 ? `every ${shown} s` : `${shown} s after the last write`;
}
