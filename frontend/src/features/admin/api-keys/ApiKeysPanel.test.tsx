import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ApiKeysPanel from "./ApiKeysPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { AdminApiKey, AdminSystem } from "@/types";

const now = Math.floor(Date.now() / 1000);

const keys: AdminApiKey[] = [
  {
    id: 1,
    fingerprint: "ab12cd34ef56",
    ident: "TR North",
    disabled: 0,
    systemsJson: "[10]",
    callRateLimit: null,
    order: 0,
    createdAt: now - 86_400,
    lastUsedAt: now - 120,
    lastUsedIp: "198.51.100.7",
    calls24h: 412,
    legacy24h: 12,
    previousKeyExpiresAt: null,
  },
  {
    id: 2,
    fingerprint: "0011aabbccdd",
    ident: "Spare",
    disabled: 1,
    systemsJson: null,
    callRateLimit: 30,
    order: 1,
    createdAt: now - 86_400,
    lastUsedAt: null,
    lastUsedIp: null,
    calls24h: 0,
    legacy24h: 0,
    previousKeyExpiresAt: null,
  },
];

const systems: AdminSystem[] = [
  { id: 10, systemId: 1, label: "County PD", autoPopulateTalkgroups: 1, blacklistsJson: null, led: null, order: 0, talkgroups: 0, units: 0, calls24h: 0, lastCall: null, blocked: [] },
  { id: 11, systemId: 2, label: "Fire", autoPopulateTalkgroups: 1, blacklistsJson: null, led: null, order: 1, talkgroups: 0, units: 0, calls24h: 0, lastCall: null, blocked: [] },
];

type Op = (arg: unknown) => Promise<unknown>;
const createOp = vi.fn<Op>();
const updateOp = vi.fn<Op>();
const deleteOp = vi.fn<Op>();
const rotateOp = vi.fn<Op>();
const mutation = (fn: Op) => [
  (arg: unknown) => ({ unwrap: () => fn(arg) }),
  { isLoading: false, isError: false },
];

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useListApiKeysQuery: () => ({ data: keys, isLoading: false }),
  useListSystemsQuery: () => ({ data: systems, isLoading: false }),
  useGetConfigQuery: () => ({ data: { settings: [{ key: "apiKeyCallRate", value: "90" }] } }),
  useCreateApiKeyMutation: () => mutation(createOp),
  useUpdateApiKeyMutation: () => mutation(updateOp),
  useDeleteApiKeyMutation: () => mutation(deleteOp),
  useRotateApiKeyMutation: () => mutation(rotateOp),
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ApiKeysPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("ApiKeysPanel", () => {
  beforeEach(() => {
    for (const op of [createOp, updateOp, deleteOp, rotateOp]) op.mockReset();
    createOp.mockResolvedValue({ ...keys[0], id: 3, ident: "Site B", createdKey: "new-secret-123" });
    updateOp.mockResolvedValue(keys[0]);
    deleteOp.mockResolvedValue({ ok: true });
    rotateOp.mockResolvedValue({ ...keys[0], createdKey: "rotated-secret", previousKeyExpiresAt: now + 86_400 });
  });

  it("lists keys by label with status, systems by name and usage", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: "API keys" });
    const north = within(table).getByText("TR North").closest("tr")!;
    expect(within(north).getByText("County PD")).toBeInTheDocument();
    expect(within(north).getByText("412")).toBeInTheDocument();
    expect(within(north).getByText("legacy")).toBeInTheDocument();
    expect(within(north).getByText("198.51.100.7")).toBeInTheDocument();
    expect(within(north).getByText(/^2 min ago/)).toBeInTheDocument();
    expect(within(north).getByText("enabled")).toBeInTheDocument();
    const spare = within(table).getByText("Spare").closest("tr")!;
    expect(within(spare).getByText("disabled")).toBeInTheDocument();
    expect(within(spare).getByText("30 / min")).toBeInTheDocument();
    expect(within(spare).getByText("All systems")).toBeInTheDocument();
    expect(within(spare).getByText("never")).toBeInTheDocument();
  });

  it("filters to keys still using the legacy path", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("radio", { name: /Legacy uploads/ }));
    expect(screen.getByText("TR North")).toBeInTheDocument();
    expect(screen.queryByText("Spare")).toBeNull();
  });

  it("creates a key and shows the secret once with a test command", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Create key" }));
    const form = within(screen.getByRole("dialog", { name: "Create API key" }));
    await user.type(form.getByLabelText("Label"), "Site B");
    await user.click(form.getByRole("button", { name: "Fire" }));
    await user.type(form.getByLabelText("Rate limit (calls per minute)"), "120");
    await user.click(form.getByRole("button", { name: "Create key" }));
    expect(createOp).toHaveBeenCalledWith({
      ident: "Site B",
      disabled: 0,
      systemsJson: "[11]",
      callRateLimit: 120,
      order: 2,
    });
    const secret = within(await screen.findByRole("dialog", { name: "Site B created" }));
    expect(secret.getByLabelText("Secret")).toHaveValue("new-secret-123");
    expect(secret.getByText(/Bearer new-secret-123/)).toBeInTheDocument();
    expect(secret.getByText(/librdioscanner_uploader\.so/)).toBeInTheDocument();
  });

  it("rotates a secret from the details panel and shows the new one", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for TR North" }));
    const details = within(screen.getByRole("dialog", { name: "TR North" }));
    expect(details.getByText("198.51.100.7")).toBeInTheDocument();
    expect(details.getByText(/12 requests in 24 h/)).toBeInTheDocument();
    await user.click(details.getByRole("button", { name: "Rotate secret" }));
    await user.click(details.getByRole("button", { name: "Rotate secret" }));
    expect(rotateOp).toHaveBeenCalledWith(1);
    const secret = within(
      await screen.findByRole("dialog", { name: "New secret for TR North" }),
    );
    expect(secret.getByLabelText("Secret")).toHaveValue("rotated-secret");
    expect(secret.getByText(/old secret keeps working until/)).toBeInTheDocument();
    expect(secret.getByText(/Bearer rotated-secret/)).toBeInTheDocument();
    await user.click(secret.getByRole("button", { name: "Copy secret" }));
    expect(await navigator.clipboard.readText()).toBe("rotated-secret");
  });

  it("asks before deleting and reports a server error in the panel", async () => {
    const user = userEvent.setup();
    deleteOp.mockRejectedValueOnce(new Error("API key not found"));
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for Spare" }));
    const details = within(screen.getByRole("dialog", { name: "Spare" }));
    await user.click(details.getByRole("button", { name: "Delete key" }));
    expect(deleteOp).not.toHaveBeenCalled();
    await user.click(details.getByRole("button", { name: "Delete key" }));
    expect(deleteOp).toHaveBeenCalledWith(2);
    expect(await details.findByRole("alert")).toHaveTextContent("API key not found");
  });

  it("enables a disabled key with the rest of it unchanged", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for Spare" }));
    const details = within(screen.getByRole("dialog", { name: "Spare" }));
    await user.click(details.getByRole("button", { name: "Enable key" }));
    await user.click(details.getByRole("button", { name: "Enable key" }));
    expect(updateOp).toHaveBeenCalledWith({
      id: 2,
      ident: "Spare",
      disabled: 0,
      systemsJson: null,
      callRateLimit: 30,
      order: 1,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Enabled Spare.");
  });

  it("edits a key in its details panel and keeps it enabled or not", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for Spare" }));
    const details = within(screen.getByRole("dialog", { name: "Spare" }));
    expect(details.getByRole("button", { name: "Save" })).toBeDisabled();
    const label = details.getByLabelText("Label");
    await user.clear(label);
    await user.type(label, "Spare 2");
    await user.click(details.getByRole("button", { name: "Fire" }));
    expect(details.getByRole("button", { name: "All systems" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.click(details.getByRole("button", { name: "Save" }));
    expect(updateOp).toHaveBeenCalledWith({
      id: 2,
      ident: "Spare 2",
      disabled: 1,
      systemsJson: "[11]",
      callRateLimit: 30,
      order: 1,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved Spare 2.");
  });

  it("keeps Save available when saving fails so it can be tried again", async () => {
    const user = userEvent.setup();
    updateOp.mockRejectedValueOnce(new Error("label already in use"));
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for Spare" }));
    const details = within(screen.getByRole("dialog", { name: "Spare" }));
    await user.type(details.getByLabelText("Label"), "!");
    await user.click(details.getByRole("button", { name: "Save" }));
    expect(await details.findByRole("alert")).toHaveTextContent("label already in use");
    expect(details.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(details.getByRole("button", { name: "Save" }));
    expect(updateOp).toHaveBeenCalledTimes(2);
  });
});
