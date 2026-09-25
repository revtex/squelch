import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TranscriptionPanel from "./TranscriptionPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { TranscriptionJob, TranscriptionModelsResponse, TranscriptionStats, TranscriptionStatus } from "@/types";

const now = Math.floor(Date.now() / 1000);

let status: TranscriptionStatus;
let stats: TranscriptionStats;
let models: TranscriptionModelsResponse;
let jobs: TranscriptionJob[];
let modelsError: string | null = null;

type Op = (arg: unknown) => Promise<unknown>;
const ops = {
  updateConfig: vi.fn<Op>(),
  test: vi.fn<Op>(),
  download: vi.fn<Op>(),
  cancel: vi.fn<Op>(),
  remove: vi.fn<Op>(),
  retry: vi.fn<Op>(),
};
const mutation = (fn: Op, loading = false) => [(arg: unknown) => ({ unwrap: () => fn(arg) }), { isLoading: loading, isError: false }];
const refetch = vi.fn();

type Listener = (topic: string, data: unknown, at: number) => void;
const listeners = new Map<string, Listener[]>();
vi.mock("@/shared/services/ws/adminClient", () => ({
  adminWsClient: {
    // The clock setting (useHour12) asks for config; offline keeps 24-hour.
    isConnected: () => false,
    on: (topic: string, cb: Listener) => {
      listeners.set(topic, [...(listeners.get(topic) ?? []), cb]);
      return () => listeners.set(topic, (listeners.get(topic) ?? []).filter((l) => l !== cb));
    },
  },
}));
function emit(topic: string, data: unknown) {
  for (const cb of listeners.get(topic) ?? []) cb(topic, data, now);
}

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useTranscriptionStatusQuery: () => ({ data: status, isLoading: false, refetch }),
  useTranscriptionStatsQuery: () => ({ data: stats, refetch }),
  useTranscriptionModelsQuery: () => ({
    data: modelsError ? undefined : models,
    isLoading: false,
    isError: !!modelsError,
    error: modelsError ? new Error(modelsError) : null,
    refetch,
  }),
  useTranscriptionJobsQuery: (st?: string) => ({ data: jobs.filter((j) => !st || j.status === st), isLoading: false, refetch }),
  useUpdateConfigMutation: () => mutation(ops.updateConfig),
  useTranscriptionTestMutation: () => mutation(ops.test),
  useTranscriptionDownloadMutation: () => mutation(ops.download),
  useCancelModelDownloadMutation: () => mutation(ops.cancel),
  useTranscriptionDeleteMutation: () => mutation(ops.remove),
  useRetryTranscriptionMutation: () => mutation(ops.retry),
}));

function renderPanel(url = "/admin/transcription") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <TranscriptionPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("TranscriptionPanel", () => {
  beforeEach(() => {
    for (const op of Object.values(ops)) op.mockReset().mockResolvedValue({ ok: true });
    listeners.clear();
    modelsError = null;
    status = {
      enabled: true,
      url: "http://whisper:9673",
      model: "ggml-small.en-tdrz",
      language: "en",
      diarize: true,
      liveDisplay: true,
      minDurationMs: 0,
      connected: true,
      version: "0.9.2",
      latencyMs: 12,
      error: "",
      workers: 2,
      queueDepth: 37,
      poolEnabled: true,
    };
    stats = {
      total: 100000,
      recent24h: 17530,
      calls24h: 19000,
      failed24h: 12,
      skipped24h: 3,
      queued: 37,
      avgDurationMs: 1800,
      minDurationMs: 400,
      maxDurationMs: 9100,
      queueDepth: 37,
      poolEnabled: true,
      byLanguage: [],
      byModel: [],
    };
    models = {
      models: [
        { id: "ggml-small.en-tdrz", object: "model", path: "a", created: now, owned_by: "whisper" },
        { id: "ggml-base.en", object: "model", path: "b", created: now, owned_by: "whisper" },
      ],
      downloads: [{ model: "ggml-medium.en", current: 62, total: 100, percent: 62 }],
    };
    jobs = [
      { callId: 1, status: "failed", error: "sidecar timed out", model: "ggml-small.en-tdrz", durationMs: 30000, createdAt: now - 60, finishedAt: now - 30, callTime: now - 120, callDurationMs: 48000, systemLabel: "Lake", talkgroupNumber: 101, talkgroupLabel: "LCSO Disp" },
      { callId: 2, status: "done", error: "", model: "ggml-small.en-tdrz", durationMs: 1700, createdAt: now - 50, finishedAt: now - 48, callTime: now - 100, callDurationMs: 6000, systemLabel: "Lake", talkgroupNumber: 102, talkgroupLabel: "LC FD Disp" },
      { callId: 3, status: "skipped", error: "shorter than 1.0 s", model: "ggml-small.en-tdrz", durationMs: 0, createdAt: now - 40, finishedAt: now - 40, callTime: now - 90, callDurationMs: 800, systemLabel: "Lake", talkgroupNumber: null, talkgroupLabel: "" },
    ];
  });

  it("shows the connection, the tiles and the sections", () => {
    renderPanel();
    expect(screen.getByRole("status", { name: "Sidecar connection" })).toHaveTextContent(
      "Connected to http://whisper:9673 · go-whisper 0.9.2 · model ggml-small.en-tdrz · 2 workers",
    );
    expect(screen.getByText("Transcribed 24 h").nextSibling).toHaveTextContent("17,530");
    expect(screen.getByText("92% of calls")).toBeInTheDocument();
    expect(screen.getByText("1.8 s")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show failures" })).toHaveAttribute("href", "/admin/transcription?tab=jobs&status=failed");
    expect(screen.getByRole("tab", { name: /Models/ })).toHaveTextContent("2");
  });

  it("says why the sidecar is not connected and reports a test", async () => {
    const user = userEvent.setup();
    status = { ...status, connected: false, version: "", error: "nothing is listening at that address", poolEnabled: false, workers: 0 };
    ops.test.mockResolvedValue({ ok: false, latencyMs: 0, version: "", models: 0, error: "nothing is listening at that address" });
    renderPanel();
    expect(screen.getByRole("status", { name: "Sidecar connection" })).toHaveTextContent(
      "Not connected to http://whisper:9673 · nothing is listening at that address",
    );
    expect(screen.getByText("Queue").nextSibling).toHaveTextContent("off");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(ops.test).toHaveBeenCalledWith({});
    expect(await screen.findByText(/Last test: Failed: nothing is listening/)).toBeInTheDocument();
  });

  it("saves every changed setting at once and can discard", async () => {
    const user = userEvent.setup();
    renderPanel();
    const bar = within(screen.getByRole("region", { name: "Unsaved changes" }));
    expect(bar.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("switch", { name: /Transcribe new calls/ }));
    await user.clear(screen.getByLabelText("Skip calls shorter than"));
    await user.type(screen.getByLabelText("Skip calls shorter than"), "1.5");
    expect(bar.getByText(/Changed:/).closest("p")).toHaveTextContent("Transcribe new calls, Skip calls shorter than");
    await user.click(bar.getByRole("button", { name: "Save" }));
    expect(ops.updateConfig).toHaveBeenCalledWith([
      { key: "transcriptionEnabled", value: "false" },
      { key: "transcriptionMinDurationMs", value: "1500" },
    ]);
    expect(await screen.findByRole("status", { name: "" })).toBeTruthy();

    await user.type(screen.getByLabelText("go-whisper URL"), "x");
    expect(bar.getByText(/Changed:/).closest("p")).toHaveTextContent("go-whisper URL");
    await user.click(bar.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("go-whisper URL")).toHaveValue("http://whisper:9673");
  });

  it("explains speaker turns and disables them without a tdrz model", () => {
    status = { ...status, model: "ggml-base.en", diarize: true };
    renderPanel();
    const sw = screen.getByRole("switch", { name: /Speaker turns/ });
    expect(sw).toBeDisabled();
    expect(sw).not.toBeChecked();
    expect(screen.getByText(/Needs a tdrz model; ggml-base.en does not support it/)).toBeInTheDocument();
  });

  it("lists models with size, speed and speaker turns, and follows a download", async () => {
    const user = userEvent.setup();
    ops.download.mockResolvedValue({ started: true, model: "ggml-large-v3-turbo" });
    renderPanel("/admin/transcription?tab=models");
    const table = screen.getByRole("table", { name: "Models" });
    const active = within(table).getByText("ggml-small.en-tdrz").closest("tr")!;
    expect(within(active).getByText("active")).toBeInTheDocument();
    expect(within(active).getByText("488 MB")).toBeInTheDocument();
    expect(within(active).getByText("yes")).toBeInTheDocument();
    expect(within(active).getByText("in use")).toBeInTheDocument();
    const base = within(table).getByText("ggml-base.en").closest("tr")!;
    expect(within(base).getByRole("button", { name: "Use" })).toBeInTheDocument();
    const medium = within(table).getByText("ggml-medium.en").closest("tr")!;
    expect(within(medium).getByRole("progressbar", { name: "Downloading ggml-medium.en" })).toHaveValue(62);

    const turbo = within(table).getByText("ggml-large-v3-turbo").closest("tr")!;
    await user.click(within(turbo).getByRole("button", { name: "Download" }));
    expect(ops.download).toHaveBeenCalledWith({ model: "ggml-large-v3-turbo" });
    act(() => emit("transcription.download.progress", { model: "ggml-large-v3-turbo", current: 30, total: 100, percent: 30 }));
    expect(within(screen.getByRole("table", { name: "Models" })).getByRole("progressbar", { name: "Downloading ggml-large-v3-turbo" })).toHaveValue(30);
    act(() => emit("transcription.download.done", { model: "ggml-large-v3-turbo" }));
    expect(await screen.findByText("Downloaded ggml-large-v3-turbo.")).toBeInTheDocument();
    expect(refetch).toHaveBeenCalled();

    await user.click(within(medium).getByRole("button", { name: "Cancel" }));
    expect(ops.cancel).toHaveBeenCalledWith({ model: "ggml-medium.en" });
  });

  it("switches the active model and asks before deleting one", async () => {
    const user = userEvent.setup();
    renderPanel("/admin/transcription?tab=models");
    const base = within(screen.getByRole("table", { name: "Models" })).getByText("ggml-base.en").closest("tr")!;
    await user.click(within(base).getByRole("button", { name: "Use" }));
    expect(ops.updateConfig).toHaveBeenCalledWith([{ key: "transcriptionModel", value: "ggml-base.en" }]);
    await user.click(within(base).getByRole("button", { name: "Delete ggml-base.en" }));
    expect(ops.remove).not.toHaveBeenCalled();
    await user.click(within(base).getByRole("button", { name: "Delete" }));
    expect(ops.remove).toHaveBeenCalledWith({ id: "ggml-base.en" });
  });

  it("reports a model list failure in words", () => {
    modelsError = "go-whisper at http://whisper:9673: nothing is listening at that address";
    renderPanel("/admin/transcription?tab=models");
    expect(screen.getByRole("alert")).toHaveTextContent("The model list could not be read");
  });

  it("filters jobs from the failures link and retries one", async () => {
    const user = userEvent.setup();
    ops.retry.mockResolvedValue({ ok: true, retried: 1 });
    renderPanel("/admin/transcription?tab=jobs&status=failed");
    expect(screen.getByRole("radio", { name: /Failed/ })).toBeChecked();
    const table = screen.getByRole("table", { name: "Recent transcription jobs" });
    expect(within(table).getByText("LCSO Disp · 0:48")).toBeInTheDocument();
    expect(within(table).queryByText(/LC FD Disp/)).toBeNull();
    expect(within(table).getByText("sidecar timed out")).toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: "Retry" }));
    expect(ops.retry).toHaveBeenCalledWith({ callId: 1 });
    expect(await screen.findByText("Queued 1 call again.")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "All" }));
    const all = screen.getByRole("table", { name: "Recent transcription jobs" });
    expect(within(all).getByText("Lake · 0:01")).toBeInTheDocument();
    expect(within(all).getByText("shorter than 1.0 s")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 2 calls" })).toBeInTheDocument();
  });
});
