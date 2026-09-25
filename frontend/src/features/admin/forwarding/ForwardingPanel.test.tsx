import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ForwardingPanel from "./ForwardingPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { AdminDownstream, AdminSystem, AdminWebhook } from "@/types";

const now = Math.floor(Date.now() / 1000);

const systems: AdminSystem[] = [
  { id: 1, label: "County", order: 0 } as AdminSystem,
  { id: 2, label: "City", order: 1 } as AdminSystem,
];

const downstreams: AdminDownstream[] = [
  {
    id: 1,
    label: "Public mirror",
    url: "https://mirror.example.org",
    hasApiKey: true,
    systemsJson: "[1]",
    disabled: 0,
    order: 0,
    last: { at: now - 30, ok: true, status: 200, error: "", millis: 120 },
    lastOkAt: now - 30,
    sent24h: 400,
    failed24h: 0,
  },
  {
    id: 2,
    label: "",
    url: "https://old.example.org",
    hasApiKey: true,
    systemsJson: null,
    disabled: 0,
    order: 1,
    last: { at: now - 600, ok: false, status: 401, error: "the server refused the API key", millis: 80 },
    lastOkAt: null,
    sent24h: 12,
    failed24h: 12,
  },
];

const webhooks: AdminWebhook[] = [
  {
    id: 5,
    label: "Ops channel",
    url: "https://discord.com/api/webhooks/1/abc",
    type: "discord",
    hasSecret: false,
    systemsJson: null,
    disabled: 1,
    order: 0,
    last: null,
    lastOkAt: null,
    sent24h: 0,
    failed24h: 0,
  },
  {
    id: 6,
    label: "Dispatch bot",
    url: "https://example.org/hooks/squelch",
    type: "generic",
    hasSecret: true,
    systemsJson: "[2]",
    disabled: 0,
    order: 1,
    last: { at: now - 5, ok: true, status: 204, error: "", millis: 40 },
    lastOkAt: now - 5,
    sent24h: 90,
    failed24h: 1,
  },
];

type Op = (arg: unknown) => Promise<unknown>;
const updateDownstream = vi.fn<Op>();
const testDownstream = vi.fn<Op>();
const deleteWebhook = vi.fn<Op>();
const updateWebhook = vi.fn<Op>();
const createWebhook = vi.fn<Op>();
const testWebhook = vi.fn<Op>();
const mutation = (fn: Op) => [
  (arg: unknown) => ({ unwrap: () => fn(arg) }),
  { isLoading: false, isError: false },
];

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useListDownstreamsQuery: () => ({ data: downstreams, isLoading: false, isError: false }),
  useListWebhooksQuery: () => ({ data: webhooks, isLoading: false, isError: false }),
  useListSystemsQuery: () => ({ data: systems, isLoading: false, isError: false }),
  useGetWebhookSampleQuery: () => ({
    data: {
      payload: { event: "call", call: { id: 18942 } },
      headers: { "X-Squelch-Event": "call" },
    },
    isLoading: false,
    isError: false,
  }),
  useCreateDownstreamMutation: () => mutation(vi.fn()),
  useUpdateDownstreamMutation: () => mutation(updateDownstream),
  useDeleteDownstreamMutation: () => mutation(vi.fn()),
  useTestDownstreamMutation: () => mutation(testDownstream),
  useCreateWebhookMutation: () => mutation(createWebhook),
  useUpdateWebhookMutation: () => mutation(updateWebhook),
  useDeleteWebhookMutation: () => mutation(deleteWebhook),
  useTestWebhookMutation: () => mutation(testWebhook),
}));

function renderPanel(path = "/admin/forwarding") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ForwardingPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("ForwardingPanel", () => {
  beforeEach(() => {
    updateDownstream.mockReset().mockResolvedValue({});
    testDownstream.mockReset().mockResolvedValue({ at: now, ok: true, status: 200, error: "", millis: 95 });
    deleteWebhook.mockReset().mockResolvedValue({ ok: true });
    updateWebhook.mockReset().mockResolvedValue({});
    createWebhook.mockReset().mockResolvedValue({ ...webhooks[1], id: 7, label: "New hook" });
    testWebhook.mockReset().mockResolvedValue({ at: now, ok: false, status: 502, error: "the target answered 502 Bad Gateway", millis: 300 });
  });

  it("lists downstreams with delivery status and explains a failing one", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: /Downstream servers/ })).toHaveAttribute("aria-selected", "true");
    const table = screen.getByRole("table", { name: "Downstreams" });
    const ok = within(table).getByText("Public mirror").closest("tr")!;
    expect(within(ok).getByText("delivering")).toBeInTheDocument();
    expect(within(ok).getByText("County")).toBeInTheDocument();
    const failing = within(table).getByText("old.example.org").closest("tr")!;
    expect(within(failing).getByText("failing")).toBeInTheDocument();
    expect(within(failing).getByText(/^12/)).toHaveTextContent("12 · the server refused the API key");
  });

  it("opens the webhooks tab from the address and filters to disabled", async () => {
    const user = userEvent.setup();
    renderPanel("/admin/forwarding?tab=webhooks");
    expect(screen.getByRole("tab", { name: /Webhooks/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("table", { name: "Webhooks" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Disabled/ }));
    expect(screen.getByText("Ops channel")).toBeInTheDocument();
    expect(screen.queryByText("Dispatch bot")).toBeNull();
  });

  it("sends a test from the details panel and shows the answer in place", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for Public mirror" }));
    const details = within(screen.getByRole("dialog", { name: "Public mirror" }));
    expect(details.getByText("Set")).toBeInTheDocument();
    await user.click(details.getByRole("button", { name: "Send a test" }));
    expect(testDownstream).toHaveBeenCalledWith(1);
    expect(await details.findByRole("status")).toHaveTextContent("Test passed. Answered 200 in 95 ms.");
  });

  it("shows a failed webhook test and the payload preview", async () => {
    const user = userEvent.setup();
    renderPanel("/admin/forwarding?tab=webhooks");
    await user.click(screen.getByRole("button", { name: "Details for Dispatch bot" }));
    const details = within(screen.getByRole("dialog", { name: "Dispatch bot" }));
    expect(details.getByText("Set, posts are signed")).toBeInTheDocument();
    expect(details.getByText("What your service receives")).toBeInTheDocument();
    expect(details.getByText(/"event": "call"/)).toBeInTheDocument();
    await user.click(details.getByRole("button", { name: "Send a test" }));
    expect(testWebhook).toHaveBeenCalledWith(6);
    expect(await details.findByRole("alert")).toHaveTextContent("Test failed. the target answered 502 Bad Gateway");
  });

  it("keeps the secret write-only when editing a webhook", async () => {
    const user = userEvent.setup();
    renderPanel("/admin/forwarding?tab=webhooks");
    await user.click(screen.getByRole("button", { name: "Details for Dispatch bot" }));
    await user.click(within(screen.getByRole("dialog", { name: "Dispatch bot" })).getByRole("button", { name: "Edit" }));
    const form = within(screen.getByRole("dialog", { name: "Edit Dispatch bot" }));
    const secret = form.getByLabelText("Secret");
    expect(secret).toHaveValue("");
    expect(form.getByText(/A secret is set/)).toBeInTheDocument();
    await user.clear(form.getByLabelText("Label"));
    await user.type(form.getByLabelText("Label"), "Dispatch bot 2");
    await user.click(form.getByRole("button", { name: "Save" }));
    expect(updateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 6, label: "Dispatch bot 2", secret: "", clearSecret: false, type: "generic" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Saved Dispatch bot 2.");
  });

  it("disables a downstream with confirmation and reports a server error", async () => {
    const user = userEvent.setup();
    updateDownstream.mockRejectedValue(new Error("downstream not found"));
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for Public mirror" }));
    const details = within(screen.getByRole("dialog", { name: "Public mirror" }));
    await user.click(details.getByRole("button", { name: "Disable" }));
    await user.click(within(details.getByRole("group", { name: "Confirm" })).getByRole("button", { name: "Disable" }));
    expect(updateDownstream).toHaveBeenCalledWith(expect.objectContaining({ id: 1, disabled: 1, apiKey: "" }));
    expect(await details.findByRole("alert")).toHaveTextContent("downstream not found");
  });
});
