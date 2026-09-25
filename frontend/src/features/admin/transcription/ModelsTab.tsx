import { useCallback, useState } from "react";
import { Download, Trash2, X } from "lucide-react";
import {
  InlineConfirm,
  useCancelModelDownloadMutation,
  useToast,
  useTranscriptionDeleteMutation,
  useTranscriptionDownloadMutation,
  useUpdateConfigMutation,
} from "@/features/admin/_shell";
import type { TranscriptionModelsResponse } from "@/types";
import { formatModelSize, modelRows, type ModelRow } from "./transcription";
import { useModelDownloads, type DownloadOutcome } from "./useModelDownloads";

export interface ModelsTabProps {
  data: TranscriptionModelsResponse | undefined;
  loading: boolean;
  error: string | null;
  activeModel: string;
  transcribing: boolean;
  onChanged: () => void;
}

function stateBadge(row: ModelRow) {
  switch (row.state) {
    case "active":
      return <span className="badge badge-success badge-sm">active</span>;
    case "downloaded":
      return <span className="badge badge-ghost badge-sm">downloaded</span>;
    case "downloading":
      return <span className="badge badge-info badge-sm">downloading</span>;
    default:
      return row.missing ? (
        <span className="badge badge-warning badge-sm">selected, not downloaded</span>
      ) : (
        <span className="badge badge-outline badge-sm">available</span>
      );
  }
}

/** The models the sidecar has and could fetch, with what each one costs. */
export default function ModelsTab({ data, loading, error, activeModel, transcribing, onChanged }: ModelsTabProps) {
  const toast = useToast();
  const [download] = useTranscriptionDownloadMutation();
  const [cancel] = useCancelModelDownloadMutation();
  const [remove] = useTranscriptionDeleteMutation();
  const [updateConfig] = useUpdateConfigMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const onEnd = useCallback(
    (o: DownloadOutcome) => {
      if (o.outcome === "done") toast.success(`Downloaded ${o.model}.`);
      else if (o.outcome === "cancelled") toast.info(`Stopped downloading ${o.model}.`);
      else toast.error(`Download of ${o.model} failed: ${o.error ?? "unknown error"}`);
      onChanged();
    },
    [toast, onChanged],
  );
  const progress = useModelDownloads(data?.downloads, onEnd);
  const rows = modelRows(data?.models, [...progress.values()], activeModel);

  const run = async (model: string, work: () => Promise<void>, fallback: string) => {
    setBusy(model);
    try {
      await work();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : fallback);
    } finally {
      setBusy(null);
    }
  };

  const use = (model: string) =>
    run(
      model,
      async () => {
        await updateConfig([{ key: "transcriptionModel", value: model }]).unwrap();
        toast.success(`${model} is now in use.`);
        onChanged();
      },
      "The model could not be selected.",
    );
  const fetch = (model: string) =>
    run(
      model,
      async () => {
        const r = await download({ model }).unwrap();
        if (r.started) toast.info(`Downloading ${model}; it continues if you leave this page.`);
      },
      "The download could not start.",
    );
  const stop = (model: string) => run(model, async () => void (await cancel({ model }).unwrap()), "The download could not be stopped.");
  const del = (model: string) =>
    run(
      model,
      async () => {
        await remove({ id: model }).unwrap();
        setConfirmDelete(null);
        toast.success(`Deleted ${model}.`);
        onChanged();
      },
      "The model could not be deleted.",
    );

  if (error) {
    return (
      <p role="alert" className="alert alert-warning text-sm">
        The model list could not be read: {error}. Check the URL under Settings.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-box border border-admin-line">
        <table className="table table-sm">
          <caption className="sr-only">Models</caption>
          <thead>
            <tr>
              <th>Model</th>
              <th>Size</th>
              <th className="hidden sm:table-cell">Speed</th>
              <th className="hidden sm:table-cell">Speaker turns</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={6} className="text-center text-base-content-dim">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isBusy = busy === row.id;
              return (
                <tr key={row.id} className={row.state === "active" ? "bg-primary/5" : ""}>
                  <td className="font-mono text-xs">
                    {row.id}
                    {row.englishOnly && <span className="ms-2 badge badge-ghost badge-xs">English</span>}
                  </td>
                  <td>{formatModelSize(row.bytes)}</td>
                  <td className="hidden sm:table-cell">{row.bytes ? row.speed : "—"}</td>
                  <td className="hidden sm:table-cell">{row.speakerTurns ? "yes" : "no"}</td>
                  <td>
                    {row.state === "downloading" && row.download ? (
                      <span className="flex items-center gap-2">
                        <progress
                          className="progress progress-info w-24"
                          value={row.download.percent}
                          max={100}
                          aria-label={`Downloading ${row.id}`}
                        />
                        <span className="text-xs tabular-nums">{Math.round(row.download.percent)}%</span>
                      </span>
                    ) : (
                      stateBadge(row)
                    )}
                  </td>
                  <td className="text-end">
                    {confirmDelete === row.id ? (
                      <InlineConfirm
                        title={`Delete ${row.id}?`}
                        text="The file is removed from the sidecar; you can download it again later."
                        button="Delete"
                        danger
                        busy={isBusy}
                        onCancel={() => setConfirmDelete(null)}
                        onConfirm={() => void del(row.id)}
                      />
                    ) : row.state === "active" ? (
                      <span className="text-xs text-base-content-dim">{transcribing ? "in use" : "selected"}</span>
                    ) : row.state === "downloaded" ? (
                      <span className="join">
                        <button type="button" className="btn btn-xs join-item" disabled={isBusy} onClick={() => void use(row.id)}>
                          Use
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost join-item"
                          aria-label={`Delete ${row.id}`}
                          disabled={isBusy}
                          onClick={() => setConfirmDelete(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    ) : row.state === "downloading" ? (
                      <button type="button" className="btn btn-xs btn-ghost" disabled={isBusy} onClick={() => void stop(row.id)}>
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Cancel
                      </button>
                    ) : (
                      <button type="button" className="btn btn-xs" disabled={isBusy} onClick={() => void fetch(row.id)}>
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        Download
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-base-content-dim">
        Sizes are the model files; speed is relative and depends on the sidecar's CPU. Downloads continue if you leave this page.
      </p>
    </div>
  );
}
