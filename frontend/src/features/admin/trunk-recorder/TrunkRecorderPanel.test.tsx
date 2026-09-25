import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { ToastProvider } from "@/features/admin/_shell";
import TrunkRecorderPanel from "./TrunkRecorderPanel";
import reducer, { applyTrEvent } from "./trMqttSlice";
import type { TrInstance } from "./types";

const lake: TrInstance = {
  id: 1,
  label: "tr-lake-north",
  instanceId: "tr-lake-north",
  brokerUrl: "tcp://mqtt:1883",
  baseTopic: "trunk-recorder",
  hasPassword: false,
  tlsSkipVerify: false,
  qos: 0,
  enabled: true,
  status: "connected",
  createdAt: 0,
  updatedAt: 0,
};
const south: TrInstance = { ...lake, id: 2, label: "tr-lake-south", instanceId: "tr-lake-south", status: "error" };

const api = vi.hoisted(() => ({
  list: vi.fn(),
  snapshot: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  test: vi.fn(),
  reconnect: vi.fn(),
}));

vi.mock("./trMqttApi", () => ({
  useListTrInstancesQuery: () => api.list(),
  useGetTrSnapshotQuery: (id: number, opts?: { skip?: boolean }) => api.snapshot(id, opts),
  useCreateTrInstanceMutation: () => [(arg: unknown) => ({ unwrap: () => api.create(arg) }), { isLoading: false }],
  useUpdateTrInstanceMutation: () => [(arg: unknown) => ({ unwrap: () => api.update(arg) }), { isLoading: false }],
  useDeleteTrInstanceMutation: () => [(arg: unknown) => ({ unwrap: () => api.remove(arg) }), { isLoading: false }],
  useTestTrInstanceMutation: () => [(arg: unknown) => ({ unwrap: () => api.test(arg) }), { isLoading: false }],
  useReconnectTrInstanceMutation: () => [(arg: unknown) => ({ unwrap: () => api.reconnect(arg) }), { isLoading: false }],
}));

function makeStore() {
  return configureStore({ reducer: { trMqtt: reducer } });
}

const SEED_AT = 1_758_800_000; // unix seconds; the slice scales to ms

function seed(store: ReturnType<typeof makeStore>) {
  const at = SEED_AT;
  const env = (payload: unknown) => ({ instanceId: 1, label: "tr-lake-north", payload });
  store.dispatch(applyTrEvent({ topic: "tr.instance.connected", envelope: env(null), at }));
  store.dispatch(applyTrEvent({ topic: "tr.pluginStatus", envelope: env({ status: "connected" }), at }));
  store.dispatch(
    applyTrEvent({
      topic: "tr.rates",
      envelope: env({ rates: [{ sys_name: "MARCS Lake", decoderate: 22.4, control_channel: 853937500 }, { sys_name: "MARCS Geauga", decoderate: 15.8 }] }),
      at,
    }),
  );
  store.dispatch(
    applyTrEvent({
      topic: "tr.rates",
      envelope: env({ rates: [{ sys_name: "MARCS Lake", decoderate: 25 }, { sys_name: "MARCS Geauga", decoderate: 15 }] }),
      at: at + 1,
    }),
  );
  store.dispatch(
    applyTrEvent({
      topic: "tr.recorders",
      envelope: env({
        recorders: [
          { id: "0_0", type: "P25", rec_state_type: "RECORDING", freq: 854112500, count: 1204 },
          { id: "0_1", type: "P25", rec_state_type: "IDLE", count: 988 },
        ],
      }),
      at,
    }),
  );
  store.dispatch(
    applyTrEvent({
      topic: "tr.callsActive",
      envelope: env({ calls: [{ call_num: 41, sys_name: "MARCS Lake", talkgroup: 41011, talkgroup_alpha_tag: "LC FD Disp", encrypted: false }, { call_num: 42, talkgroup: 41025, encrypted: true }] }),
      at,
    }),
  );
  store.dispatch(applyTrEvent({ topic: "tr.systems", envelope: env({ systems: [{ sys_name: "MARCS Lake", type: "p25" }, { sys_name: "MARCS Geauga", type: "p25" }] }), at }));
  store.dispatch(applyTrEvent({ topic: "tr.message", envelope: env({ message: { sys_name: "MARCS Lake", opcode: "0x03", trunk_msg_type: "GRANT" } }), at }));
}

function renderPage(store: ReturnType<typeof makeStore>, url = "/admin/trunk-recorder") {
  return render(
    <Provider store={store}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/admin/trunk-recorder" element={<TrunkRecorderPanel />} />
            <Route path="/admin/settings" element={<p>settings page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockReturnValue({ data: [lake, south], isLoading: false, error: undefined });
  api.snapshot.mockReturnValue({ data: undefined });
});

describe("TrunkRecorderPanel", () => {
  it("shows the banner, tiles and the instance from the URL", () => {
    // Rates are only "ok" while they are recent.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((SEED_AT + 5) * 1000);
    const store = makeStore();
    seed(store);
    renderPage(store, "/admin/trunk-recorder?instance=1");
    const banner = screen.getByRole("status", { name: "Recorder connection" });
    expect(banner).toHaveTextContent("tr-lake-north");
    expect(banner).toHaveTextContent("tr-lake-north · broker tcp://mqtt:1883 connected · plugin connected · last frame 5 s ago");
    expect(screen.getByText("Systems", { selector: "dt" }).nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Recorders", { selector: "dt" }).nextSibling).toHaveTextContent("1 / 2");
    expect(screen.getByText("Active calls", { selector: "dt" }).nextSibling).toHaveTextContent("2");
    expect(screen.getByText("1 encrypted")).toBeInTheDocument();
    expect(screen.getByText("Decode rate", { selector: "dt" }).nextSibling).toHaveTextContent("40.0");
    expect(screen.getByText(/min 38 · max 40/)).toBeInTheDocument();
    // The dashboard tab lists systems with their rates.
    const table = screen.getByRole("table", { name: "Systems" });
    expect(within(table).getByText("MARCS Lake")).toBeInTheDocument();
    expect(within(table).getByText("25.0 /s")).toBeInTheDocument();
    expect(within(table).getAllByText("ok")).toHaveLength(2);
    expect(api.snapshot).toHaveBeenCalledWith(1, { skip: false });
    vi.useRealTimers();
  });

  it("never calls a system ok on a rate that stopped arriving", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((SEED_AT + 120) * 1000);
    const store = makeStore();
    seed(store);
    renderPage(store, "/admin/trunk-recorder?instance=1");
    const table = within(screen.getByRole("table", { name: "Systems" }));
    expect(table.queryByText("ok")).not.toBeInTheDocument();
    expect(table.getAllByText("no recent rate")).toHaveLength(2);
    vi.useRealTimers();
  });

  it("never calls a system ok while the broker is disconnected", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((SEED_AT + 5) * 1000);
    const store = makeStore();
    seed(store);
    store.dispatch(
      applyTrEvent({
        topic: "tr.instance.disconnected",
        envelope: { instanceId: 1, label: "tr-lake-north", payload: null, error: "broker went away" },
        at: SEED_AT + 3,
      }),
    );
    renderPage(store, "/admin/trunk-recorder?instance=1");
    const table = within(screen.getByRole("table", { name: "Systems" }));
    expect(table.queryByText("ok")).not.toBeInTheDocument();
    expect(table.getAllByText("no feed")).toHaveLength(2);
    vi.useRealTimers();
  });

  it("switches instance from the header and keeps it in the URL", () => {
    const store = makeStore();
    seed(store);
    renderPage(store, "/admin/trunk-recorder?instance=1");
    fireEvent.change(screen.getByRole("combobox", { name: "Instance" }), { target: { value: "2" } });
    const banner = screen.getByRole("status", { name: "Recorder connection" });
    expect(banner).toHaveTextContent("tr-lake-south");
    expect(banner).toHaveTextContent("connection failed");
    expect(api.snapshot).toHaveBeenLastCalledWith(2, { skip: false });
  });

  it("points at Settings when the integration is off", () => {
    api.list.mockReturnValue({ data: undefined, isLoading: false, error: { status: 404 } });
    renderPage(makeStore());
    expect(screen.getByRole("alert")).toHaveTextContent("Trunk Recorder MQTT is off");
    expect(screen.getByRole("link", { name: "Settings → Integrations" })).toHaveAttribute("href", "/admin/settings?q=Trunk%20Recorder#settings-integrations");
    expect(screen.queryByRole("button", { name: /Add instance/ })).not.toBeInTheDocument();
  });

  it("tests the broker from the panel with the result in place, and removes after confirming", async () => {
    const store = makeStore();
    seed(store);
    api.test.mockResolvedValue({ ok: false, error: "dial tcp: connection refused" });
    api.remove.mockResolvedValue(undefined);
    renderPage(store, "/admin/trunk-recorder?instance=1");
    fireEvent.click(screen.getByRole("button", { name: /Instance settings/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Broker URL" })).toHaveValue("tcp://mqtt:1883");
    fireEvent.click(within(dialog).getByRole("button", { name: /Test broker/ }));
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("connection refused"));
    expect(api.test).toHaveBeenCalledWith(1);

    fireEvent.click(within(dialog).getByRole("button", { name: /Remove instance/ }));
    const confirm = within(dialog).getByRole("group", { name: "Confirm" });
    expect(confirm).toHaveTextContent("Remove tr-lake-north?");
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(1));
    expect(store.getState().trMqtt.recorders[1]).toBeUndefined();
  });

  it("adds an instance from the form and validates before sending", async () => {
    const store = makeStore();
    api.create.mockResolvedValue({ ...lake, id: 9, label: "tr-geauga" });
    renderPage(store, "/admin/trunk-recorder?instance=1");
    fireEvent.click(screen.getByRole("button", { name: /Add instance/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0);
    expect(api.create).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Label" }), { target: { value: "tr-geauga" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Instance ID" }), { target: { value: "tr-geauga" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Base topic" }), { target: { value: "tr-geauga" } });
    expect(within(dialog).getByRole("textbox", { name: "Units topic" })).toHaveValue("tr-geauga/units");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toMatchObject({ label: "tr-geauga", instanceId: "tr-geauga", baseTopic: "tr-geauga", unitTopic: "tr-geauga/units", messageTopic: "tr-geauga/messages", qos: 0, enabled: true });
  });

  it("lists recorders and calls as tables, and pauses the message feed with a new-count", () => {
    const store = makeStore();
    seed(store);
    renderPage(store, "/admin/trunk-recorder?instance=1&tab=recorders");
    const recorders = screen.getByRole("table", { name: "Recorders" });
    expect(within(recorders).getByText("0_0")).toBeInTheDocument();
    expect(within(recorders).getByText("recording")).toBeInTheDocument();
    expect(within(recorders).getByText("1,204")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Calls/ }));
    const calls = screen.getByRole("table", { name: "Calls in progress" });
    expect(within(calls).getByText("LC FD Disp")).toBeInTheDocument();
    expect(within(calls).getByText("encrypted")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
    expect(within(screen.getByRole("table", { name: "Messages by opcode" })).getByText("0x03")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Live/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => {
      store.dispatch(
        applyTrEvent({
          topic: "tr.message",
          envelope: { instanceId: 1, label: "tr-lake-north", payload: { message: { sys_name: "MARCS Lake", opcode: "0x05", trunk_msg_type: "GRANT" } } },
          at: Date.now() + 5000,
        }),
      );
    });
    expect(screen.getAllByRole("status").map((el) => el.textContent)).toContain("Paused · 1 new message waiting");
    expect(screen.queryByText("0x05")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText("0x05")).toBeInTheDocument();
  });
});
