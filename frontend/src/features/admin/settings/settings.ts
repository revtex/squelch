import type { AdminSetting, Capabilities } from "@/types";

/** How a setting is edited. */
export type SettingKind = "text" | "email" | "number" | "switch" | "choice";

export interface SettingChoice {
  id: string;
  label: string;
  hint?: string;
}

export interface SettingRow {
  key: string;
  label: string;
  hint: string;
  kind: SettingKind;
  /** Shown after a number input: "days", "ms", "a minute". */
  unit?: string;
  min?: number;
  max?: number;
  choices?: SettingChoice[];
  /** The switch shows the positive of a negatively named key. */
  invert?: boolean;
  /** Only editable while the parent key has (or does not have) a value. */
  dependsOn?: { key: string; value?: string; not?: string };
  /** Saved the moment it changes, without the Save bar. */
  applyAtOnce?: boolean;
  /** Listeners can override it for themselves. */
  perUser?: boolean;
  /** The value assumed when the server has none. */
  fallback: string;
}

export interface SettingGroup {
  id: string;
  title: string;
  hint?: string;
  rows: SettingRow[];
}

const BOOL = { fallback: "false" } as const;

export const AUDIO_CONVERSION: SettingChoice[] = [
  { id: "0", label: "Keep the original" },
  { id: "1", label: "Convert only" },
  { id: "2", label: "Convert and normalise peaks" },
  { id: "3", label: "Convert and normalise loudness" },
];

export const ENCODING_PRESETS: SettingChoice[] = [
  { id: "mp3_32k", label: "MP3 · 32 kbps" },
  { id: "mp3_24k", label: "MP3 · 24 kbps" },
  { id: "mp3_16k", label: "MP3 · 16 kbps" },
  { id: "aac_lc_32k", label: "AAC-LC · 32 kbps" },
  { id: "aac_lc_24k", label: "AAC-LC · 24 kbps" },
  { id: "aac_lc_16k", label: "AAC-LC · 16 kbps" },
  { id: "he_aac_12k", label: "HE-AAC · 12 kbps" },
  { id: "he_aac_8k", label: "HE-AAC · 8 kbps" },
];

export const HE_AAC_PRESETS = new Set(["he_aac_12k", "he_aac_8k"]);

export const GROUPS: SettingGroup[] = [
  {
    id: "general",
    title: "General",
    rows: [
      {
        key: "branding",
        label: "Instance name",
        hint: "Shown above the scanner display and in the browser tab.",
        kind: "text",
        max: 64,
        fallback: "",
      },
      {
        key: "email",
        label: "Support email",
        hint: "Listeners see it on the sign-in page and in error messages.",
        kind: "email",
        fallback: "",
      },
    ],
  },
  {
    id: "scanner",
    title: "Scanner",
    hint: "Defaults for every listener. Each listener can override the ones marked per user.",
    rows: [
      {
        key: "time12hFormat",
        label: "12-hour clock",
        hint: "Off shows 24-hour times everywhere, including the admin.",
        kind: "switch",
        ...BOOL,
      },
      {
        key: "showListenersCount",
        label: "Show listener count",
        hint: "The live listener number on the scanner display.",
        kind: "switch",
        ...BOOL,
      },
      {
        key: "keypadBeeps",
        label: "Keypad beeps",
        hint: "The default sound set; each listener can pick their own from the scanner's menu.",
        kind: "choice",
        perUser: true,
        choices: [
          { id: "uniden", label: "Uniden" },
          { id: "whistler", label: "Whistler" },
          { id: "disabled", label: "Off" },
        ],
        fallback: "uniden",
      },
    ],
  },
  {
    id: "radio",
    title: "Radio data",
    rows: [
      {
        key: "autoPopulateSystems",
        label: "Create systems from uploads",
        hint: "Unknown system numbers in uploads become new systems, with talkgroup auto-create on. Off rejects them.",
        kind: "switch",
        fallback: "true",
      },
    ],
  },
  {
    id: "ingest",
    title: "Ingest & audio",
    rows: [
      {
        key: "apiKeyCallRate",
        label: "Default upload rate limit",
        hint: "Calls a minute per API key unless the key sets its own.",
        kind: "number",
        unit: "a minute",
        min: 1,
        max: 600,
        fallback: "60",
      },
      {
        key: "disableDuplicateDetection",
        label: "Reject duplicate calls",
        hint: "The same talkgroup within the window below counts as a duplicate.",
        kind: "switch",
        invert: true,
        ...BOOL,
      },
      {
        key: "duplicateDetectionTimeFrame",
        label: "Duplicate window",
        hint: "Calls this close together on one talkgroup are duplicates.",
        kind: "number",
        unit: "ms",
        min: 0,
        max: 60_000,
        dependsOn: { key: "disableDuplicateDetection", value: "false" },
        fallback: "500",
      },
      {
        key: "audioConversion",
        label: "Convert audio on upload",
        hint: "Re-encodes with FFmpeg before storing, so recorded WAV becomes MP3 or AAC.",
        kind: "choice",
        choices: AUDIO_CONVERSION,
        fallback: "0",
      },
      {
        key: "audioEncodingPreset",
        label: "Encoding",
        hint: "MP3 32 kbps is the safe default. HE-AAC needs libfdk_aac in FFmpeg.",
        kind: "choice",
        choices: ENCODING_PRESETS,
        dependsOn: { key: "audioConversion", not: "0" },
        fallback: "mp3_32k",
      },
    ],
  },
  {
    id: "storage",
    title: "Storage",
    rows: [
      {
        key: "pruneDays",
        label: "Delete calls older than",
        hint: "0 keeps everything. Shared calls are kept until their link expires.",
        kind: "number",
        unit: "days",
        min: 0,
        max: 3650,
        fallback: "7",
      },
      {
        key: "connectionHistoryDays",
        label: "Keep connection history",
        hint: "How long Connections → History remembers who connected. 0 stops recording.",
        kind: "number",
        unit: "days",
        min: 0,
        max: 3650,
        fallback: "30",
      },
    ],
  },
  {
    id: "sharing",
    title: "Sharing",
    rows: [
      {
        key: "shareableLinks",
        label: "Let listeners share calls",
        hint: "Adds a Share button to the scanner. Links work without signing in.",
        kind: "switch",
        ...BOOL,
      },
      {
        key: "sharedLinkExpiry",
        label: "Links expire after",
        hint: "0 means never.",
        kind: "number",
        unit: "days",
        min: 0,
        max: 3650,
        dependsOn: { key: "shareableLinks", value: "true" },
        fallback: "0",
      },
    ],
  },
  {
    id: "access",
    title: "Access & security",
    rows: [
      {
        key: "publicAccess",
        label: "Public listening",
        hint: "Anyone with the address can listen without an account. Admin pages always need a sign-in.",
        kind: "switch",
        ...BOOL,
      },
      {
        key: "maxClients",
        label: "Listener limit",
        hint: "Most live connections at once across everyone. 0 means no limit.",
        kind: "number",
        unit: "listeners",
        min: 0,
        max: 100_000,
        fallback: "200",
      },
      {
        key: "loginMaxFailures",
        label: "Lock out sign-in after",
        hint: "Failed attempts from one address before it must wait. Applies at once.",
        kind: "number",
        unit: "failures",
        min: 1,
        max: 20,
        fallback: "3",
      },
      {
        key: "loginLockoutMinutes",
        label: "Lockout lasts",
        hint: "How long a locked-out address waits. Users → Sign-in lockouts can clear one early.",
        kind: "number",
        unit: "minutes",
        min: 1,
        max: 1440,
        fallback: "10",
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    rows: [
      {
        key: "trMqttEnabled",
        label: "Trunk Recorder MQTT",
        hint: "Live recorder telemetry on the Trunk Recorder page. Brokers are configured there.",
        kind: "switch",
        ...BOOL,
      },
    ],
  },
  {
    id: "logging",
    title: "Logging",
    rows: [
      {
        key: "logLevel",
        label: "Log level",
        hint: "Applies at once, without Save. Debug is noisy; turn it back down when done.",
        kind: "choice",
        applyAtOnce: true,
        choices: [
          { id: "info", label: "Info" },
          { id: "debug", label: "Debug" },
          { id: "warn", label: "Warn" },
          { id: "error", label: "Error" },
        ],
        fallback: "info",
      },
      {
        key: "auditRetentionDays",
        label: "Keep the audit trail for",
        hint: "Sign-ins and admin changes on Logs & audit are removed after this long.",
        kind: "number",
        unit: "days",
        min: 1,
        max: 3650,
        fallback: "90",
      },
    ],
  },
];

export const ALL_ROWS: SettingRow[] = GROUPS.flatMap((g) => g.rows);
export const ROW_BY_KEY = new Map(ALL_ROWS.map((r) => [r.key, r]));

/** The server's values by key. */
export function serverValues(settings: AdminSetting[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of settings ?? []) out[s.key] = s.value;
  return out;
}

/** The value a row shows: the draft if edited, else the server's, else the fallback. */
export function currentValue(row: SettingRow, server: Record<string, string>, draft: Record<string, string>): string {
  return draft[row.key] ?? server[row.key] ?? row.fallback;
}

/** Whether a dependent row's parent allows editing it. */
export function rowEnabled(
  row: SettingRow,
  server: Record<string, string>,
  draft: Record<string, string>,
  capabilities: Capabilities | undefined,
): boolean {
  if (row.dependsOn) {
    const parent = ROW_BY_KEY.get(row.dependsOn.key);
    const value = parent ? currentValue(parent, server, draft) : (draft[row.dependsOn.key] ?? server[row.dependsOn.key] ?? "");
    if (row.dependsOn.value !== undefined && value !== row.dependsOn.value) return false;
    if (row.dependsOn.not !== undefined && value === row.dependsOn.not) return false;
  }
  if ((row.key === "audioConversion" || row.key === "audioEncodingPreset") && capabilities && !capabilities.ffmpeg) {
    return false;
  }
  return true;
}

/** A validation message for a value, or null when it can be saved. */
export function validate(row: SettingRow, value: string): string | null {
  const v = value.trim();
  switch (row.kind) {
    case "number": {
      if (!/^-?\d+$/.test(v)) return "Enter a whole number.";
      const n = Number(v);
      if (row.min !== undefined && n < row.min) return `Must be at least ${row.min}.`;
      if (row.max !== undefined && n > row.max) return `Must be ${row.max} or less.`;
      return null;
    }
    case "email":
      if (v && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)) return "Enter a plain address such as ops@example.org.";
      return null;
    case "text":
      if (row.max !== undefined && v.length > row.max) return `Must be ${row.max} characters or fewer.`;
      return null;
    default:
      return null;
  }
}

/** Rows whose label, help or key mention the search. */
export function matchesSearch(row: SettingRow, group: SettingGroup, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${group.title} ${row.label} ${row.hint} ${row.key}`.toLowerCase().includes(q);
}

/** The rows that differ from the server, in page order. */
export function changedRows(server: Record<string, string>, draft: Record<string, string>): SettingRow[] {
  return ALL_ROWS.filter((r) => r.key in draft && draft[r.key] !== (server[r.key] ?? r.fallback));
}

/** Every setting by name and section, for the admin's search box. */
export const SETTINGS_INDEX: readonly { label: string; section: string }[] =
  GROUPS.flatMap((g) => g.rows.map((r) => ({ label: r.label, section: g.title })));
