import { describe, it, expect } from "vitest";
import reducer, {
  applyTrEvent,
  setSnapshot,
  forgetInstance,
  type TrMqttState,
} from "./trMqttSlice";
import type { TrEventEnvelope, SnapshotView } from "./types";

const ID = 1;

function envelope(payload: unknown, error?: string): TrEventEnvelope {
  return { instanceId: ID, label: "test", payload, error };
}

function emptyState(): TrMqttState {
  return reducer(undefined, { type: "@@INIT" });
}

describe("trMqttSlice", () => {
  it("tr.instance.connected marks instance connected and clears error", () => {
    const before: TrMqttState = {
      ...emptyState(),
      instances: { [ID]: { connected: false, lastError: "boom" } },
    };
    const next = reducer(
      before,
      applyTrEvent({
        topic: "tr.instance.connected",
        envelope: envelope({}),
        at: 1000,
      }),
    );
    expect(next.instances[ID]).toEqual({
      connected: true,
      lastError: undefined,
      lastSeenAt: 1000,
    });
  });

  it("tr.instance.disconnected captures envelope error", () => {
    const next = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.instance.disconnected",
        envelope: envelope({}, "broker down"),
        at: 5,
      }),
    );
    expect(next.instances[ID].connected).toBe(false);
    expect(next.instances[ID].lastError).toBe("broker down");
  });

  it("normalizes admin ws epoch-second timestamps to milliseconds", () => {
    const next = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.instance.connected",
        envelope: envelope({}),
        at: 1_777_675_411,
      }),
    );
    expect(next.instances[ID].lastSeenAt).toBe(1_777_675_411_000);
  });

  it("tr.rates pushes a sample with aggregated decoderate", () => {
    const next = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.rates",
        envelope: envelope({
          rates: [{ decoderate: 1.5 }, { decoderate: 2.5 }],
        }),
        at: 100,
      }),
    );
    expect(next.rates[ID]).toEqual([{ at: 100, rate: 4 }]);
  });

  it("tr.rates caps the rolling window to 300 samples", () => {
    let s = emptyState();
    for (let i = 0; i < 305; i++) {
      s = reducer(
        s,
        applyTrEvent({
          topic: "tr.rates",
          envelope: envelope({ rates: [{ decoderate: i }] }),
          at: i,
        }),
      );
    }
    expect(s.rates[ID]).toHaveLength(300);
    expect(s.rates[ID][0].rate).toBe(5);
    expect(s.rates[ID][299].rate).toBe(304);
  });

  it("tr.message captures opcode/desc and caps to 500", () => {
    let s = emptyState();
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.message",
        envelope: envelope({
          message: {
            opcode: 0x39,
            opcode_desc: "GRP_V_CH_GRANT",
            sys_name: "sys1",
            trunk_msg_type: "GRANT",
          },
        }),
        at: 1,
      }),
    );
    expect(s.trunkingMessages[ID]).toHaveLength(1);
    const e = s.trunkingMessages[ID][0];
    expect(e.opcode).toBe("57");
    expect(e.opcodeDesc).toBe("GRP_V_CH_GRANT");
    expect(e.shortname).toBe("sys1");
    expect(e.type).toBe("GRANT");

    for (let i = 0; i < 510; i++) {
      s = reducer(
        s,
        applyTrEvent({
          topic: "tr.message",
          envelope: envelope({ message: { opcode: i } }),
          at: i,
        }),
      );
    }
    expect(s.trunkingMessages[ID]).toHaveLength(500);
  });

  it("tr.unit.* pushes unit events and caps to 200", () => {
    let s = emptyState();
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.unit.on",
        envelope: envelope({ unit_id: 4242, talkgroup: 11, shortname: "sys1" }),
        at: 1,
      }),
    );
    expect(s.unitEvents[ID]).toHaveLength(1);
    const e = s.unitEvents[ID][0];
    expect(e.kind).toBe("on");
    expect(e.unitId).toBe("4242");
    expect(e.talkgroupId).toBe("11");

    for (let i = 0; i < 210; i++) {
      s = reducer(
        s,
        applyTrEvent({
          topic: "tr.unit.call",
          envelope: envelope({ unit_id: i }),
          at: i,
        }),
      );
    }
    expect(s.unitEvents[ID]).toHaveLength(200);
  });

  it("tr.warn.lag stamps lagWarning timestamp", () => {
    const next = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.warn.lag",
        envelope: envelope({}),
        at: 9999,
      }),
    );
    expect(next.lagWarning[ID]).toBe(9999);
  });

  it("tr.recorders / tr.callsActive / tr.systems / tr.config store payload as-is", () => {
    let s = emptyState();
    const cases = [
      ["tr.recorders", "recorders"],
      ["tr.callsActive", "callsActive"],
      ["tr.systems", "systems"],
      ["tr.config", "config"],
    ] as const;
    for (const [topic, key] of cases) {
      const payload = { tag: topic };
      s = reducer(
        s,
        applyTrEvent({ topic, envelope: envelope(payload), at: 1 }),
      );
      expect((s[key] as Record<number, unknown>)[ID]).toEqual(payload);
    }
  });

  it("setSnapshot hydrates snapshot + connection from REST", () => {
    const snap: SnapshotView = {
      InstanceID: ID,
      Label: "test",
      PluginInstanceID: "tr1",
      Connection: { Connected: true, LastConnected: "now" },
    };
    const next = reducer(emptyState(), setSnapshot({ id: ID, snapshot: snap }));
    expect(next.snapshots[ID]).toBe(snap);
    expect(next.instances[ID].connected).toBe(true);
  });

  it("forgetInstance drops every per-instance map", () => {
    let s = emptyState();
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.rates",
        envelope: envelope({ rates: [{ decoderate: 1 }] }),
        at: 1,
      }),
    );
    s = reducer(s, forgetInstance(ID));
    expect(s.rates[ID]).toBeUndefined();
    expect(s.instances[ID]).toBeUndefined();
  });

  it("ignores unknown tr.* topics without throwing", () => {
    const next = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.someFutureTopic",
        envelope: envelope({}),
        at: 1,
      }),
    );
    expect(next).toEqual(emptyState());
  });

  it("tr.rates also stores per-system breakdown by sys_name", () => {
    const next = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.rates",
        envelope: envelope({
          rates: [
            {
              sys_num: 0,
              sys_name: "sys1",
              decoderate: 12.5,
              decoderate_interval: 3,
              control_channel: 851000000,
            },
            { sys_num: 1, sys_name: "sys2", decoderate: 4.0 },
          ],
        }),
        at: 50,
      }),
    );
    expect(next.systemRates[ID].sys1).toEqual({
      sysNum: 0,
      sysName: "sys1",
      decoderate: 12.5,
      decoderateInterval: 3,
      controlChannel: 851000000,
      at: 50,
    });
    expect(next.systemRates[ID].sys2.decoderate).toBe(4.0);
  });

  it("tr.callStart and tr.callEnd push to recentCalls with kind", () => {
    let s = emptyState();
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.callStart",
        envelope: envelope({
          call: {
            id: "abc",
            call_num: "42",
            sys_name: "sys1",
            sys_num: 0,
            freq: 851012500,
            unit: "1234",
            unit_alpha_tag: "DISP1",
            talkgroup: "100",
            talkgroup_alpha_tag: "FIRE OPS",
            talkgroup_group: "Fire",
            encrypted: false,
            emergency: true,
          },
        }),
        at: 200,
      }),
    );
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.callEnd",
        envelope: envelope({
          call: {
            id: "abc",
            call_num: "42",
            sys_name: "sys1",
            length: 7.5,
            stop_time: 1700000007,
          },
        }),
        at: 210,
      }),
    );
    expect(s.recentCalls[ID]).toHaveLength(2);
    expect(s.recentCalls[ID][0].kind).toBe("start");
    expect(s.recentCalls[ID][0].talkgroupAlpha).toBe("FIRE OPS");
    expect(s.recentCalls[ID][0].emergency).toBe(true);
    expect(s.recentCalls[ID][1].kind).toBe("end");
    expect(s.recentCalls[ID][1].length).toBe(7.5);
  });

  it("tr.pluginStatus stores connected/disconnected with client id", () => {
    const next = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.pluginStatus",
        envelope: envelope({
          status: "connected",
          client_id: "tr-1234",
          instance_id: "trunk-recorder",
        }),
        at: 33,
      }),
    );
    expect(next.pluginStatus[ID]).toEqual({
      status: "connected",
      clientId: "tr-1234",
      instanceId: "trunk-recorder",
      at: 33,
    });
  });

  it("tr.unit.* captures alpha tags and talkgroup metadata when present", () => {
    const next = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.unit.call",
        envelope: envelope({
          sys_name: "sys1",
          unit: 5555,
          unit_alpha_tag: "PD-15",
          talkgroup: 200,
          talkgroup_alpha_tag: "PATROL 2",
          talkgroup_group: "Police",
          talkgroup_tag: "Law Dispatch",
          freq: 851000000,
          encrypted: true,
        }),
        at: 7,
      }),
    );
    const e = next.unitEvents[ID][0];
    expect(e.unitAlpha).toBe("PD-15");
    expect(e.talkgroupAlpha).toBe("PATROL 2");
    expect(e.talkgroupGroup).toBe("Police");
    expect(e.freq).toBe(851000000);
    expect(e.encrypted).toBe(true);
  });

  it("tr.message captures opcode_type and meta lines", () => {
    const next = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.message",
        envelope: envelope({
          message: {
            sys_name: "sys1",
            sys_num: 0,
            trunk_msg: "0x39 GRP_V_CH_GRANT tg=100 src=1234",
            trunk_msg_type: "GRANT",
            opcode: 0x39,
            opcode_type: "voice_grant",
            opcode_desc: "GRP_V_CH_GRANT",
            meta: "Granting tg 100 to 1234",
          },
        }),
        at: 4,
      }),
    );
    const m = next.trunkingMessages[ID][0];
    expect(m.opcode).toBe("57");
    expect(m.opcodeType).toBe("voice_grant");
    expect(m.trunkMsg).toContain("GRP_V_CH_GRANT");
    expect(m.meta).toBe("Granting tg 100 to 1234");
    expect(m.sysNum).toBe(0);
  });

  it("forgetInstance also drops systemRates / pluginStatus / recentCalls", () => {
    let s = emptyState();
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.rates",
        envelope: envelope({ rates: [{ sys_name: "s", decoderate: 1 }] }),
        at: 1,
      }),
    );
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.pluginStatus",
        envelope: envelope({ status: "connected" }),
        at: 2,
      }),
    );
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.callStart",
        envelope: envelope({ call: { id: "x" } }),
        at: 3,
      }),
    );
    s = reducer(s, forgetInstance(ID));
    expect(s.systemRates[ID]).toBeUndefined();
    expect(s.pluginStatus[ID]).toBeUndefined();
    expect(s.recentCalls[ID]).toBeUndefined();
  });

  it("tr.instance.disconnected clears stale plugin status", () => {
    let s = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.pluginStatus",
        envelope: envelope({ status: "connected", client_id: "c1" }),
        at: 10,
      }),
    );
    expect(s.pluginStatus[ID]?.status).toBe("connected");
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.instance.disconnected",
        envelope: envelope({}, "broker down"),
        at: 20,
      }),
    );
    expect(s.pluginStatus[ID]).toBeUndefined();
  });

  it("data frames refresh a stale 'disconnected' plugin badge to connected", () => {
    let s = reducer(
      emptyState(),
      applyTrEvent({
        topic: "tr.pluginStatus",
        envelope: envelope({ status: "disconnected", client_id: "c1" }),
        at: 10,
      }),
    );
    expect(s.pluginStatus[ID]?.status).toBe("disconnected");
    s = reducer(
      s,
      applyTrEvent({
        topic: "tr.rates",
        envelope: envelope({ rates: [{ decoderate: 1 }] }),
        at: 50,
      }),
    );
    expect(s.pluginStatus[ID]?.status).toBe("connected");
    expect(s.pluginStatus[ID]?.clientId).toBe("c1");
  });

  it("setSnapshot fills empty views from the REST snapshot without clobbering live frames", () => {
    const snap: SnapshotView = {
      InstanceID: ID,
      Label: "test",
      PluginInstanceID: "tr1",
      Connection: { Connected: true },
      Recorders: { recorders: [{ id: "0_0", rec_state_type: "RECORDING" }] },
      CallsActive: { calls: [] },
      Systems: { systems: [{ sys_name: "lake" }] },
      Config: { config: { instance_id: "tr1", sources: [] } },
      PluginStatus: { status: "connected" },
      Rates: { rates: [{ sys_name: "lake", decoderate: 20 }, { sys_name: "geauga", decoderate: 15 }] },
      RateSamples: [
        { At: "2026-09-25T12:00:00Z", System: "lake", Rate: 20 },
        { At: "2026-09-25T12:00:00Z", System: "geauga", Rate: 15 },
        { At: "2026-09-25T12:00:01Z", System: "lake", Rate: 22 },
      ],
      UnitEvents: [{ ReceivedAt: "2026-09-25T12:00:01Z", Topic: "tr/units/lake/on", Frame: { kind: "on", sys_name: "lake", unit: 7100101 } }],
      Messages: [{ ReceivedAt: "2026-09-25T12:00:01Z", Topic: "tr/messages", Frame: { message: { sys_name: "lake", opcode: "0x03", trunk_msg_type: "GRANT" } } }],
    };
    const next = reducer(emptyState(), setSnapshot({ id: ID, snapshot: snap }));
    expect(next.recorders[ID]).toBe(snap.Recorders);
    expect(next.systems[ID]).toBe(snap.Systems);
    expect(next.config[ID]).toBe(snap.Config);
    expect(next.pluginStatus[ID]?.status).toBe("connected");
    expect(next.rates[ID].map((s) => s.rate)).toEqual([35, 22]);
    expect(next.systemRates[ID].lake.decoderate).toBe(20);
    expect(next.unitEvents[ID][0]).toMatchObject({ kind: "on", shortname: "lake", unitId: "7100101" });
    expect(next.trunkingMessages[ID][0]).toMatchObject({ opcode: "0x03", type: "GRANT", shortname: "lake" });

    // Live frames already seen win over the snapshot; older rate samples
    // from the snapshot go in front of the live ones.
    let liveFirst = reducer(
      emptyState(),
      applyTrEvent({ topic: "tr.recorders", envelope: envelope({ recorders: [{ id: "live" }] }) }),
    );
    liveFirst = reducer(
      liveFirst,
      applyTrEvent({ topic: "tr.rates", envelope: envelope({ rates: [{ sys_name: "lake", decoderate: 30 }] }), at: Date.parse("2026-09-25T12:00:01Z") }),
    );
    const merged = reducer(liveFirst, setSnapshot({ id: ID, snapshot: snap }));
    expect(merged.recorders[ID]).toEqual({ recorders: [{ id: "live" }] });
    expect(merged.rates[ID].map((s) => s.rate)).toEqual([35, 30]);
  });
});
