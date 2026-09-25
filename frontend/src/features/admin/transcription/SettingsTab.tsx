import { useEffect, useId, useMemo, useState } from "react";
import { Field, SwitchRow, plural, useNavigationGuard, useToast, useUpdateConfigMutation } from "@/features/admin/_shell";
import type { TranscriptionStatus } from "@/types";
import { LANGUAGES, supportsSpeakerTurns } from "./transcription";

export interface SettingsTabProps {
  status: TranscriptionStatus;
  /** Tries a URL and returns whether it answered. */
  onTest: (url: string) => Promise<boolean>;
  testing: boolean;
  onSaved: () => void;
}

interface Draft {
  enabled: boolean;
  liveDisplay: boolean;
  url: string;
  language: string;
  diarize: boolean;
  /** Seconds, as typed. */
  minSeconds: string;
}

const KEYS: Record<keyof Draft, string> = {
  enabled: "transcriptionEnabled",
  liveDisplay: "liveTranscriptDisplay",
  url: "transcriptionUrl",
  language: "transcriptionLanguage",
  diarize: "transcriptionDiarize",
  minSeconds: "transcriptionMinDurationMs",
};

const LABELS: Record<keyof Draft, string> = {
  enabled: "Transcribe new calls",
  liveDisplay: "Show transcripts in the scanner",
  url: "go-whisper URL",
  language: "Language",
  diarize: "Speaker turns",
  minSeconds: "Skip calls shorter than",
};

function fromStatus(s: TranscriptionStatus): Draft {
  return {
    enabled: s.enabled,
    liveDisplay: s.liveDisplay,
    url: s.url,
    language: s.language || "en",
    diarize: s.diarize,
    minSeconds: s.minDurationMs ? String(s.minDurationMs / 1000) : "0",
  };
}

function toValue(key: keyof Draft, d: Draft): string {
  switch (key) {
    case "enabled":
    case "liveDisplay":
    case "diarize":
      return String(d[key]);
    case "minSeconds":
      return String(Math.round(Number(d.minSeconds || "0") * 1000));
    default:
      return d[key].trim();
  }
}

/** Every transcription setting, saved together with one button. */
export default function SettingsTab({ status, onTest, testing, onSaved }: SettingsTabProps) {
  const id = useId();
  const toast = useToast();
  const [updateConfig] = useUpdateConfigMutation();
  const server = useMemo(() => fromStatus(status), [status]);
  const [overrides, setOverrides] = useState<Partial<Draft>>({});
  const [saving, setSaving] = useState(false);
  const { setGuard } = useNavigationGuard();

  const draft: Draft = { ...server, ...overrides };
  const changed = (Object.keys(KEYS) as (keyof Draft)[]).filter((k) => toValue(k, draft) !== toValue(k, server));
  const dirty = changed.length > 0;

  useEffect(() => {
    setGuard(dirty ? () => true : null);
    return () => setGuard(null);
  }, [dirty, setGuard]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setOverrides((o) => ({ ...o, [key]: value }));

  const urlOk = /^https?:\/\/\S+$/.test(draft.url.trim());
  const secs = Number(draft.minSeconds);
  const minOk = draft.minSeconds.trim() !== "" && Number.isFinite(secs) && secs >= 0 && secs <= 60;
  const speakerTurnsOk = supportsSpeakerTurns(status.model);
  const errors = [...(urlOk ? [] : ["url"]), ...(minOk ? [] : ["minSeconds"])];

  const save = async () => {
    setSaving(true);
    try {
      await updateConfig(changed.map((k) => ({ key: KEYS[k], value: toValue(k, draft) }))).unwrap();
      setOverrides({});
      toast.success(`Saved ${changed.map((k) => LABELS[k]).join(", ")}.`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "The settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="rounded-box border border-admin-line bg-base-100 divide-y divide-admin-line">
        <div className="p-3">
          <SwitchRow
            id={`${id}-enabled`}
            label="Transcribe new calls"
            hint="Off pauses the queue; nothing is lost."
            checked={draft.enabled}
            onChange={(v) => set("enabled", v)}
          />
        </div>
        <div className="p-3">
          <SwitchRow
            id={`${id}-live`}
            label="Show transcripts in the scanner"
            hint="Listeners see text under the display while a call plays."
            checked={draft.liveDisplay}
            onChange={(v) => set("liveDisplay", v)}
          />
        </div>
        <div className="p-3">
          <Field
            htmlFor={`${id}-url`}
            label="go-whisper URL"
            hint="The sidecar's base URL, reachable from the server."
            error={urlOk ? null : "Must start with http:// or https://"}
          >
            <div className="flex gap-2">
              <input
                id={`${id}-url`}
                type="url"
                className="input w-full"
                placeholder="http://whisper:8081"
                value={draft.url}
                onChange={(e) => set("url", e.target.value)}
              />
              <button type="button" className="btn" disabled={!urlOk || testing} onClick={() => void onTest(draft.url.trim())}>
                {testing ? "Testing…" : "Test"}
              </button>
            </div>
          </Field>
        </div>
        <div className="p-3">
          <Field htmlFor={`${id}-lang`} label="Language" hint="Auto-detect costs a little time per call.">
            <select id={`${id}-lang`} className="select w-full sm:w-64" value={draft.language} onChange={(e) => set("language", e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="p-3">
          <SwitchRow
            id={`${id}-diarize`}
            label="Speaker turns"
            hint={
              speakerTurnsOk
                ? "Splits the text by speaker. The active model supports it."
                : `Splits the text by speaker. Needs a tdrz model; ${status.model || "the active one"} does not support it.`
            }
            checked={draft.diarize && speakerTurnsOk}
            disabled={!speakerTurnsOk}
            onChange={(v) => set("diarize", v)}
          />
        </div>
        <div className="p-3">
          <Field
            htmlFor={`${id}-min`}
            label="Skip calls shorter than"
            hint="Saves queue time on key-ups. 0 sends every call."
            error={minOk ? null : "Enter 0 to 60 seconds"}
          >
            <label className="input w-32">
              <input
                id={`${id}-min`}
                type="number"
                min={0}
                max={60}
                step={0.5}
                inputMode="decimal"
                className="grow"
                value={draft.minSeconds}
                onChange={(e) => set("minSeconds", e.target.value)}
              />
              <span className="text-base-content-dim">s</span>
            </label>
          </Field>
        </div>
      </div>

      <div
        role="region"
        aria-label="Unsaved changes"
        className="fixed inset-x-0 bottom-16 z-20 border-t border-admin-line bg-base-100/95 px-3 py-2 backdrop-blur md:bottom-0 md:left-24 lg:left-56"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm">
            {dirty ? (
              <>
                <span className="font-medium">Changed:</span> {changed.map((k) => LABELS[k]).join(", ")}
                {errors.length > 0 && <span className="text-error"> · {plural(errors.length, "value needs", "values need")} fixing</span>}
              </>
            ) : (
              <span className="text-base-content-dim">Every change here needs Save, toggles included.</span>
            )}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty || saving} onClick={() => setOverrides({})}>
              Discard
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saving || errors.length > 0} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
