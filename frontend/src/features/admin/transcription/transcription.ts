import type { ModelDownload, TranscriptionJob, TranscriptionJobStatus, WhisperModel } from "@/types";

export type Tab = "settings" | "models" | "jobs";

export function tabFrom(raw: string | null): Tab {
  return raw === "models" || raw === "jobs" ? raw : "settings";
}

export const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
  { value: "ko", label: "Korean" },
  { value: "ru", label: "Russian" },
  { value: "ar", label: "Arabic" },
  { value: "pl", label: "Polish" },
  { value: "sv", label: "Swedish" },
] as const;

export type Speed = "fastest" | "fast" | "medium" | "slow";

/** What is known about each whisper.cpp model before it is downloaded. */
export interface CatalogueEntry {
  id: string;
  /** Approximate file size in bytes. */
  bytes: number;
  speed: Speed;
  /** Whether the model marks speaker turns (tinydiarize). */
  speakerTurns: boolean;
  /** English-only models are faster and better at English. */
  englishOnly: boolean;
}

const MB = 1_000_000;
const GB = 1_000_000_000;

/** whisper.cpp's public models; sizes are the ggml files on Hugging Face. */
export const CATALOGUE: CatalogueEntry[] = [
  { id: "ggml-tiny", bytes: 78 * MB, speed: "fastest", speakerTurns: false, englishOnly: false },
  { id: "ggml-tiny.en", bytes: 78 * MB, speed: "fastest", speakerTurns: false, englishOnly: true },
  { id: "ggml-base", bytes: 148 * MB, speed: "fastest", speakerTurns: false, englishOnly: false },
  { id: "ggml-base.en", bytes: 148 * MB, speed: "fastest", speakerTurns: false, englishOnly: true },
  { id: "ggml-small", bytes: 488 * MB, speed: "fast", speakerTurns: false, englishOnly: false },
  { id: "ggml-small.en", bytes: 488 * MB, speed: "fast", speakerTurns: false, englishOnly: true },
  { id: "ggml-small.en-tdrz", bytes: 488 * MB, speed: "fast", speakerTurns: true, englishOnly: true },
  { id: "ggml-medium", bytes: 1.5 * GB, speed: "medium", speakerTurns: false, englishOnly: false },
  { id: "ggml-medium.en", bytes: 1.5 * GB, speed: "medium", speakerTurns: false, englishOnly: true },
  { id: "ggml-medium-q5_0", bytes: 539 * MB, speed: "medium", speakerTurns: false, englishOnly: false },
  { id: "ggml-large-v3-turbo", bytes: 1.6 * GB, speed: "medium", speakerTurns: false, englishOnly: false },
  { id: "ggml-large-v3", bytes: 3.1 * GB, speed: "slow", speakerTurns: false, englishOnly: false },
];

export function catalogueFor(id: string): CatalogueEntry | undefined {
  return CATALOGUE.find((c) => c.id === id);
}

/** Whether a model id marks speaker turns; unknown models are judged by name. */
export function supportsSpeakerTurns(id: string): boolean {
  return catalogueFor(id)?.speakerTurns ?? id.includes("tdrz");
}

export type ModelState = "active" | "downloaded" | "downloading" | "available";

export interface ModelRow extends CatalogueEntry {
  state: ModelState;
  download?: ModelDownload;
  /** Selected in settings but not on the sidecar: calls would fail. */
  missing?: boolean;
}

/** The catalogue merged with what the sidecar has and is fetching. */
export function modelRows(
  downloaded: WhisperModel[] | undefined,
  downloads: ModelDownload[] | undefined,
  activeId: string,
): ModelRow[] {
  const have = new Map((downloaded ?? []).map((m) => [m.id, m]));
  const fetching = new Map((downloads ?? []).map((d) => [d.model, d]));
  const ids = new Set<string>([...CATALOGUE.map((c) => c.id), ...have.keys(), ...fetching.keys()]);
  const rows: ModelRow[] = [];
  for (const id of ids) {
    const cat = catalogueFor(id) ?? { id, bytes: 0, speed: "medium" as const, speakerTurns: id.includes("tdrz"), englishOnly: id.includes(".en") };
    let state: ModelState = "available";
    if (fetching.has(id)) state = "downloading";
    else if (id === activeId && have.has(id)) state = "active";
    else if (have.has(id)) state = "downloaded";
    const missing = id === activeId && state === "available";
    rows.push({ ...cat, state, download: fetching.get(id), missing });
  }
  const order: Record<ModelState, number> = { active: 0, downloading: 1, downloaded: 2, available: 3 };
  return rows.sort(
    (a, b) => Number(b.missing ?? false) - Number(a.missing ?? false) || order[a.state] - order[b.state] || a.bytes - b.bytes || a.id.localeCompare(b.id),
  );
}

export function formatModelSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

/** "1.8 s" for a duration in milliseconds. */
export function formatSecs(ms: number): string {
  if (!ms) return "—";
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "0:48" for a call length in milliseconds. */
export function formatCallLength(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function jobTitle(j: TranscriptionJob): string {
  const tg = j.talkgroupLabel || (j.talkgroupNumber != null ? `TG ${j.talkgroupNumber}` : j.systemLabel);
  return `${tg} · ${formatCallLength(j.callDurationMs)}`;
}

export const JOB_STATUS_LABEL: Record<TranscriptionJobStatus, string> = {
  queued: "queued",
  done: "done",
  failed: "failed",
  skipped: "skipped",
};

/** The queue's direction, from two readings a few seconds apart. */
export function queueTrend(now: number, before: number | null): "growing" | "shrinking" | "steady" {
  if (before == null || now === before) return "steady";
  return now > before ? "growing" : "shrinking";
}
