import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SettingsPanel from "./SettingsPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { ConfigResponse } from "@/types";

const updateConfig = vi.fn<(arg: unknown) => Promise<unknown>>();
let config: ConfigResponse;

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useGetConfigQuery: () => ({ data: config, isLoading: false }),
  useUpdateConfigMutation: () => [
    (arg: unknown) => ({ unwrap: () => updateConfig(arg) }),
    { isLoading: false, isError: false },
  ],
}));

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/admin/settings"]}>
      <ToastProvider>
        <SettingsPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    updateConfig.mockReset().mockResolvedValue({});
    config = {
      settings: [
        { key: "branding", value: "Lake County" },
        { key: "email", value: "" },
        { key: "pruneDays", value: "30" },
        { key: "shareableLinks", value: "false" },
        { key: "sharedLinkExpiry", value: "0" },
        { key: "disableDuplicateDetection", value: "true" },
        { key: "audioConversion", value: "0" },
        { key: "logLevel", value: "info" },
      ],
      capabilities: { ffmpeg: true, fdkAac: false, whisper: false },
      storage: {
        recordingsBytes: 41_200_000_000,
        recordingFiles: 12_304,
        measuredAt: 1_700_000_000,
        volumeTotalBytes: 120_000_000_000,
        volumeFreeBytes: 79_000_000_000,
        databaseBytes: 820_000_000,
        oldestCall: 1_690_000_000,
      },
      trustedAddresses: ["198.51.100.7/32"],
    };
  });

  it("shows the groups with storage figures, trusted addresses and disabled dependent rows", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Storage" })).toBeInTheDocument();
    expect(screen.getByTestId("storage-line")).toHaveTextContent(
      "41 GB of recordings in 12304 files. Volume 120 GB, 79 GB free. Database 820 MB.",
    );
    expect(screen.getByText("198.51.100.7/32")).toBeInTheDocument();
    expect(screen.getByLabelText("Links expire after")).toBeDisabled();
    // "Reject duplicate calls" is the positive of disableDuplicateDetection=true.
    expect(screen.getByRole("switch", { name: /Reject duplicate calls/ })).not.toBeChecked();
    expect(screen.getByLabelText("Duplicate window")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Encoding" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent("No unsaved changes");
  });

  it("lists what changed, discards, and saves only the changed keys", async () => {
    const user = userEvent.setup();
    renderPanel();
    const prune = screen.getByLabelText("Delete calls older than");
    await user.clear(prune);
    await user.type(prune, "45");
    await user.click(screen.getByRole("switch", { name: /Reject duplicate calls/ }));
    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    expect(bar).toHaveTextContent("Changed: Reject duplicate calls, Delete calls older than");
    expect(within(screen.getByLabelText("Delete calls older than").closest("div.p-3")!).getByText("Changed")).toBeInTheDocument();
    // Turning duplicate rejection on enables the window beneath it.
    expect(screen.getByLabelText("Duplicate window")).toBeEnabled();

    await user.click(within(bar).getByRole("button", { name: "Discard" }));
    expect(bar).toHaveTextContent("No unsaved changes");
    expect(screen.getByLabelText("Delete calls older than")).toHaveValue(30);

    await user.clear(screen.getByLabelText("Delete calls older than"));
    await user.type(screen.getByLabelText("Delete calls older than"), "45");
    await user.click(screen.getByRole("switch", { name: /Reject duplicate calls/ }));
    await user.click(within(bar).getByRole("button", { name: "Save changes" }));
    expect(updateConfig).toHaveBeenCalledWith([
      { key: "disableDuplicateDetection", value: "false" },
      { key: "pruneDays", value: "45" },
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 2 settings.");
  });

  it("refuses to save a value out of range and says why", async () => {
    const user = userEvent.setup();
    renderPanel();
    const prune = screen.getByLabelText("Delete calls older than");
    await user.clear(prune);
    await user.type(prune, "9999");
    expect(screen.getByRole("alert")).toHaveTextContent("Must be 3650 or less.");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent("1 value needs fixing");
  });

  it("applies the log level at once without the save bar", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(within(screen.getByRole("radiogroup", { name: "Log level" })).getByRole("radio", { name: "Debug" }));
    expect(updateConfig).toHaveBeenCalledWith([{ key: "logLevel", value: "debug" }]);
    expect(await screen.findByRole("status")).toHaveTextContent("The server now logs at debug. This applies at once.");
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent("No unsaved changes");
  });

  it("marks the section in view in the rail and moves the mark on a click", async () => {
    const user = userEvent.setup();
    renderPanel();
    const rail = within(screen.getByRole("navigation", { name: "Setting groups" }));
    expect(rail.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "location");
    await user.click(rail.getByRole("link", { name: "Storage" }));
    expect(rail.getByRole("link", { name: "Storage" })).toHaveAttribute("aria-current", "location");
    expect(rail.getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current");
  });

  it("finds a setting by what it says", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole("searchbox", { name: "Find a setting" }), "lock");
    expect(screen.getByLabelText("Lock out sign-in after")).toBeInTheDocument();
    expect(screen.queryByLabelText("Delete calls older than")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Storage" })).toBeNull();
  });
});
