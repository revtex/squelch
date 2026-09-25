// Top-level Trunk Recorder MQTT panel — internal sub-tabs spanning the
// full plugin schema. Each tab is a focused dashboard so heavy frames
// (recorders / messages) don't crowd the live overview.
import { useState } from "react";
import InstancesPanel from "./InstancesPanel";
import DashboardView from "./DashboardView";
import CallsView from "./CallsView";
import RecordersView from "./RecordersView";
import SystemsView from "./SystemsView";
import UnitsView from "./UnitsView";
import TrunkingMessagesView from "./TrunkingMessagesView";
import ConfigView from "./ConfigView";
import { useListTrInstancesQuery } from "./trMqttApi";
import type { TrInstance } from "./types";

type SubTab =
  | "instances"
  | "dashboard"
  | "calls"
  | "recorders"
  | "systems"
  | "units"
  | "messages"
  | "config";

const TABS: { key: SubTab; label: string }[] = [
  { key: "instances", label: "Instances" },
  { key: "dashboard", label: "Dashboard" },
  { key: "calls", label: "Calls" },
  { key: "recorders", label: "Recorders" },
  { key: "systems", label: "Systems" },
  { key: "units", label: "Units" },
  { key: "messages", label: "Messages" },
  { key: "config", label: "Config" },
];

export default function TrMqttPanel() {
  const { data: instances = [], error } = useListTrInstancesQuery();
  // `tab === null` means "no explicit selection yet" — derive a sensible
  // default from the live instance list. Once the user clicks a tab we
  // honor their choice and stop auto-defaulting.
  const [tab, setTab] = useState<SubTab | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const activeTab: SubTab =
    tab ?? (instances.length > 0 ? "dashboard" : "instances");

  const selected =
    instances.find((i) => i.id === selectedId) ??
    (instances.length > 0 ? instances[0] : null);

  function selectAndOpen(inst: TrInstance) {
    setSelectedId(inst.id);
    setTab("dashboard");
  }

  if (error) {
    return (
      <div className="alert alert-warning">
        <span>
          Trunk Recorder MQTT integration is not enabled. Open{" "}
          <span className="font-semibold">
            Settings → Integrations → Trunk Recorder MQTT
          </span>{" "}
          and toggle{" "}
          <span className="font-mono">Trunk Recorder MQTT</span> on to
          use this dashboard.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div role="tablist" className="tabs tabs-boxed bg-base-200 flex-wrap">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            className={`tab ${activeTab === key ? "tab-active" : ""}`}
            onClick={() => setTab(key)}
            disabled={key !== "instances" && !selected}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "instances" && <InstancesPanel onSelect={selectAndOpen} />}
      {activeTab === "dashboard" && selected && (
        <DashboardView instance={selected} />
      )}
      {activeTab === "calls" && selected && <CallsView instance={selected} />}
      {activeTab === "recorders" && selected && (
        <RecordersView instance={selected} />
      )}
      {activeTab === "systems" && selected && (
        <SystemsView instance={selected} />
      )}
      {activeTab === "units" && selected && <UnitsView instance={selected} />}
      {activeTab === "messages" && selected && (
        <TrunkingMessagesView instance={selected} />
      )}
      {activeTab === "config" && selected && <ConfigView instance={selected} />}
      {activeTab !== "instances" && !selected && (
        <div className="text-base-content/60">No instance selected.</div>
      )}
    </div>
  );
}
