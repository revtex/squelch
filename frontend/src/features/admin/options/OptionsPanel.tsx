import { useState, useEffect, useMemo, useRef } from "react";
import { Globe, Radio, AudioLines, Share2, Plug, Cable } from "lucide-react";
import {
  useGetConfigQuery,
  useUpdateConfigMutation,
} from "@/features/admin/_shell";
import { useNavigationGuard } from "@/features/admin/_shell";
import type { AdminSetting } from "@/types";

// ─── Known setting keys and their input types ───

const BOOLEAN_KEYS = [
  "publicAccess",
  "shareableLinks",
  "time12hFormat",
  "disableDuplicateDetection",
  "showListenersCount",
  "trMqttEnabled",
] as const;

const AUDIO_CONVERSION_MODES: Record<string, string> = {
  "0": "Disabled",
  "1": "Enabled (no normalization)",
  "2": "Normalize",
  "3": "Loudnorm",
};

const AUDIO_ENCODING_PRESETS: Record<string, string> = {
  mp3_32k: "MP3 32 kbps (default)",
  mp3_24k: "MP3 24 kbps",
  mp3_16k: "MP3 16 kbps",
  aac_lc_32k: "AAC-LC 32 kbps",
  aac_lc_24k: "AAC-LC 24 kbps",
  aac_lc_16k: "AAC-LC 16 kbps",
  he_aac_12k: "HE-AAC 12 kbps",
  he_aac_8k: "HE-AAC 8 kbps",
};

const HE_AAC_PRESETS = new Set(["he_aac_12k", "he_aac_8k"]);

interface SettingSection {
  title: string;
  icon: React.ReactNode;
  keys: string[];
}

const SECTIONS: SettingSection[] = [
  {
    title: "General",
    icon: <Globe className="w-4 h-4" />,
    keys: ["branding", "email", "publicAccess"],
  },
  {
    title: "Scanner Behavior",
    icon: <Radio className="w-4 h-4" />,
    keys: ["time12hFormat", "showListenersCount", "maxClients"],
  },
  {
    title: "Call Processing",
    icon: <AudioLines className="w-4 h-4" />,
    keys: [
      "audioConversion",
      "audioEncodingPreset",
      "disableDuplicateDetection",
      "duplicateDetectionTimeFrame",
      "pruneDays",
    ],
  },
  {
    title: "Sharing",
    icon: <Share2 className="w-4 h-4" />,
    keys: ["shareableLinks", "sharedLinkExpiry"],
  },
  {
    title: "Connections",
    icon: <Cable className="w-4 h-4" />,
    keys: ["connectionHistoryDays"],
  },
  {
    title: "Integrations",
    icon: <Plug className="w-4 h-4" />,
    keys: ["trMqttEnabled"],
  },
];

// Only keys that appear in SECTIONS should be sent to the backend.
// The DB may contain additional client-side-only keys (e.g. darkMode,
// dimmerDelay) that are not in the backend's allowedSettingKeys whitelist.
const SAVEABLE_KEYS = new Set(SECTIONS.flatMap((s) => s.keys));

const LABELS: Record<string, string> = {
  publicAccess: "Public Access",
  shareableLinks: "Shareable Links",
  sharedLinkExpiry: "Shared Link Expiry (days)",
  audioConversion: "Audio Conversion (FFmpeg)",
  audioEncodingPreset: "Audio Encoding Preset",
  branding: "Branding Label",
  email: "Support Email",
  time12hFormat: "12-Hour Time Format",
  maxClients: "Max Simultaneous Clients",
  disableDuplicateDetection: "Disable Duplicate Call Detection",
  duplicateDetectionTimeFrame: "Duplicate Detection Time Frame (ms)",
  pruneDays: "Prune Database After (days)",
  connectionHistoryDays: "Keep Connection History (days)",
  showListenersCount: "Show Listeners Count",
  trMqttEnabled: "Enable Trunk Recorder MQTT",
};

const DESCRIPTIONS: Record<string, string> = {
  publicAccess: "Allow unauthenticated listeners to access the scanner.",
  branding:
    "Short label shown above the scanner display to identify this instance.",
  email: "Support contact email shown to users.",
  time12hFormat: "Display timestamps in 12-hour (AM/PM) format.",
  maxClients: "Maximum number of simultaneous WebSocket listeners.",
  showListenersCount:
    "Display the active listener count on the main scanner screen.",
  audioConversion:
    "Convert incoming audio with FFmpeg before storing. Select the codec and bitrate below.",
  audioEncodingPreset:
    "Codec and bitrate for converted audio. HE-AAC presets require libfdk_aac in your FFmpeg build. Lower bitrates save storage; choose based on your quality needs.",
  disableDuplicateDetection:
    "Disable automatic rejection of duplicate incoming calls.",
  duplicateDetectionTimeFrame:
    "Calls within ±this many milliseconds of an existing call with the same system/talkgroup are rejected as duplicates.",
  pruneDays:
    "Automatically delete calls older than this many days. Set to 0 to disable.",
  connectionHistoryDays:
    "How long Admin → Connections keeps a record of who connected, from which address, and when. Set to 0 to stop recording.",
  sharedLinkExpiry:
    "Number of days before shared links expire. Set to 0 to disable (links never expire).",
  trMqttEnabled:
    "Subscribe to one or more trunk-recorder MQTT status feeds and surface a live admin dashboard. Configure brokers under Dashboards → Trunk Recorder → Instances. See docs/tr-mqtt-guide.md for details.",
};

function isBooleanKey(key: string): boolean {
  return (BOOLEAN_KEYS as readonly string[]).includes(key);
}

export default function OptionsPanel() {
  const { data: config, isLoading } = useGetConfigQuery();
  const [updateConfig] = useUpdateConfigMutation();

  const capabilities = config?.capabilities;
  const settings = config?.settings;

  const [localSettings, setLocalSettings] = useState<Record<string, string>>(
    {},
  );
  const [configLoaded, setConfigLoaded] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Build a map of original server values for dirty comparison.
  const serverSettings = useMemo(() => {
    const map: Record<string, string> = {};
    if (settings) {
      for (const s of settings) {
        map[s.key] = s.value;
      }
    }
    for (const key of SAVEABLE_KEYS) {
      if (!(key in map)) {
        map[key] = isBooleanKey(key) ? "false" : "0";
      }
    }
    return map;
  }, [settings]);

  if (settings && !configLoaded) {
    const map: Record<string, string> = {};
    for (const s of settings) {
      map[s.key] = s.value;
    }
    // Seed keys declared in SECTIONS so they always render, even if
    // never persisted to the DB yet.
    for (const key of SAVEABLE_KEYS) {
      if (!(key in map)) {
        map[key] = isBooleanKey(key) ? "false" : "0";
      }
    }
    setLocalSettings(map);
    setConfigLoaded(true);
  }

  const isDirty = useMemo(() => {
    if (!configLoaded) return false;
    for (const key of Object.keys(localSettings)) {
      if (localSettings[key] !== serverSettings[key]) return true;
    }
    return false;
  }, [localSettings, serverSettings, configLoaded]);

  // Warn on browser/tab close with unsaved changes.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Register navigation guard so AdminLayout can block tab switches.
  const { setGuard } = useNavigationGuard();
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);
  useEffect(() => {
    setGuard(() => isDirtyRef.current);
    return () => setGuard(null);
  }, [setGuard]);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const updateSetting = (key: string, value: string) => {
    if (key === "audioConversion" && value !== "0") {
      setLocalSettings((prev) => {
        const preset = prev["audioEncodingPreset"];
        return {
          ...prev,
          [key]: value,
          ...(!preset ? { audioEncodingPreset: "mp3_32k" } : {}),
        };
      });
      return;
    }
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!isDirty) return;

    const settings: AdminSetting[] = Object.entries(localSettings)
      .filter(([key]) => SAVEABLE_KEYS.has(key))
      .map(([key, value]) => ({ key, value }));
    try {
      await updateConfig(settings).unwrap();
      showToast("Settings saved successfully", "success");
      // RTK Query invalidates "Config" tag → refetch updates serverSettings
      // automatically via the useMemo, so isDirty clears on its own.
    } catch (err) {
      console.error("Failed to save settings:", err);
      showToast("Failed to save settings", "error");
    }
  };

  const renderSettingInput = (key: string) => {
    const value = localSettings[key] ?? "";

    if (isBooleanKey(key)) {
      return (
        <div className="flex flex-col">
          <label className="flex items-center cursor-pointer justify-start gap-4">
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={value === "true"}
              onChange={(e) =>
                updateSetting(key, e.target.checked ? "true" : "false")
              }
            />
            <div className="flex-1">
              <span className="text-sm font-medium">{LABELS[key] ?? key}</span>
              {DESCRIPTIONS[key] && (
                <p className="text-xs text-base-content/60 mt-0.5">
                  {DESCRIPTIONS[key]}
                </p>
              )}
            </div>
          </label>
        </div>
      );
    }

    const label = (
      <div className="pb-0">
        <span className="text-sm font-medium">{LABELS[key] ?? key}</span>
      </div>
    );
    const description = DESCRIPTIONS[key] ? (
      <p className="text-xs text-base-content/60 mb-1">{DESCRIPTIONS[key]}</p>
    ) : null;

    if (key === "audioConversion") {
      const ffmpegMissing = capabilities && !capabilities.ffmpeg;
      return (
        <div className="flex flex-col">
          {label}
          {description}
          <select
            className="select w-full"
            value={value}
            onChange={(e) => updateSetting(key, e.target.value)}
            disabled={!!ffmpegMissing}
          >
            {Object.entries(AUDIO_CONVERSION_MODES).map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl}
              </option>
            ))}
          </select>
          {ffmpegMissing && (
            <p className="text-xs text-warning mt-1">
              FFmpeg is not installed. Install it and restart the service to
              enable audio conversion.
            </p>
          )}
        </div>
      );
    }

    if (key === "audioEncodingPreset") {
      const conversionDisabled =
        (localSettings["audioConversion"] ?? "0") === "0";
      const ffmpegMissing = capabilities && !capabilities.ffmpeg;
      const fdkAacAvailable = !!capabilities?.fdkAac;
      const visiblePresets = Object.entries(AUDIO_ENCODING_PRESETS).filter(
        ([preset]) => fdkAacAvailable || !HE_AAC_PRESETS.has(preset),
      );
      const selectedValue =
        value && (!HE_AAC_PRESETS.has(value) || fdkAacAvailable)
          ? value
          : "mp3_32k";
      return (
        <div className="flex flex-col">
          {label}
          {description}
          <select
            className="select w-full"
            value={selectedValue}
            onChange={(e) => updateSetting(key, e.target.value)}
            disabled={!!ffmpegMissing || conversionDisabled}
          >
            {visiblePresets.map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl}
              </option>
            ))}
          </select>
          {!fdkAacAvailable && (
            <p className="text-xs text-warning mt-1">
              libfdk_aac not detected in FFmpeg; HE-AAC presets are unavailable.
            </p>
          )}
          {conversionDisabled && (
            <p className="text-xs text-base-content/50 mt-1">
              Enable audio conversion above to activate this setting.
            </p>
          )}
        </div>
      );
    }

    if (
      key === "maxClients" ||
      key === "pruneDays" ||
      key === "connectionHistoryDays" ||
      key === "duplicateDetectionTimeFrame" ||
      key === "sharedLinkExpiry"
    ) {
      return (
        <div className="flex flex-col">
          {label}
          {description}
          <input
            type="number"
            className="input w-full"
            value={value}
            min={0}
            onChange={(e) => updateSetting(key, e.target.value)}
          />
        </div>
      );
    }

    // Default: text input
    return (
      <div className="flex flex-col">
        {label}
        {description}
        <input
          type="text"
          className="input w-full"
          value={value}
          onChange={(e) => updateSetting(key, e.target.value)}
        />
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Options</h1>
        <p className="text-sm text-base-content/70">
          Global settings for the scanner. Changes take effect immediately for
          all connected clients.
        </p>
      </div>

      <div className="columns-1 md:columns-2 xl:columns-3 gap-6">
        {SECTIONS.map((section) => {
          const keys = section.keys;
          const hasSettings = keys.some((k) => k in localSettings);
          if (!hasSettings) return null;

          return (
            <section
              key={section.title}
              className="mb-6 break-inside-avoid inline-block w-full"
            >
              <h2 className="flex items-center gap-2 text-base font-semibold mb-3">
                {section.icon} {section.title}
              </h2>
              <div className="card bg-base-200">
                <div className="card-body gap-3">
                  {keys.map((key) =>
                    key in localSettings ? (
                      <div
                        key={key}
                        className="relative rounded-lg border border-base-300 bg-base-100/60 p-3"
                      >
                        {localSettings[key] !== serverSettings[key] && (
                          <span
                            className="absolute right-2 top-2 w-2 h-2 rounded-full bg-warning"
                            title="Modified"
                          />
                        )}
                        {renderSettingInput(key)}
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* ── Save Bar ──────────────────────────────────── */}
      <div className="sticky bottom-0 z-10 flex items-center gap-3 rounded-lg border border-base-300 bg-base-200 p-3">
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={!isDirty}
        >
          Save Changes
        </button>
        {isDirty && (
          <span className="text-warning text-sm">Unsaved changes</span>
        )}
        {toast && (
          <span
            className={`text-sm ${toast.type === "success" ? "text-success" : "text-error"}`}
          >
            {toast.message}
          </span>
        )}
      </div>
    </div>
  );
}
