import { useEffect, useState } from "react";
import { adminWsClient } from "@/shared/services/ws/adminClient";
import type { ModelDownload } from "@/types";

export interface DownloadOutcome {
  model: string;
  outcome: "done" | "failed" | "cancelled";
  error?: string;
}

function isProgress(data: unknown): data is ModelDownload {
  return typeof data === "object" && data !== null && typeof (data as ModelDownload).model === "string";
}

/**
 * Live download progress from the server's transcription.download.* events,
 * seeded from the models query so a page opened mid-download catches up.
 * onEnd fires once per download that finishes, however it finished.
 */
export function useModelDownloads(initial: ModelDownload[] | undefined, onEnd: (o: DownloadOutcome) => void) {
  const [live, setLive] = useState<Map<string, ModelDownload>>(() => new Map());
  const [ended, setEnded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const unsubs = [
      adminWsClient.on("transcription.download.progress", (_t, data) => {
        if (!isProgress(data)) return;
        setLive((prev) => new Map(prev).set(data.model, data));
        setEnded((prev) => {
          if (!prev.has(data.model)) return prev;
          const next = new Set(prev);
          next.delete(data.model);
          return next;
        });
      }),
      ...(["done", "failed", "cancelled"] as const).map((outcome) =>
        adminWsClient.on(`transcription.download.${outcome}`, (_t, data) => {
          if (!isProgress(data)) return;
          setLive((prev) => {
            const next = new Map(prev);
            next.delete(data.model);
            return next;
          });
          setEnded((prev) => new Set(prev).add(data.model));
          onEnd({ model: data.model, outcome, error: (data as { error?: string }).error });
        }),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [onEnd]);

  // What the server listed when the page loaded, unless it has since ended,
  // overlaid with the progress events seen since.
  const merged = new Map<string, ModelDownload>();
  for (const d of initial ?? []) if (!ended.has(d.model)) merged.set(d.model, d);
  for (const [k, v] of live) merged.set(k, v);
  return merged;
}
