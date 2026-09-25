import { useState } from "react";
import {
  useDetails,
  useListConnectionsQuery,
  useListIPBlocksQuery,
  useListSessionsQuery,
} from "@/features/admin/_shell";
import LiveTab from "./LiveTab";
import DevicesTab from "./DevicesTab";
import HistoryTab, { type HistoryScope } from "./HistoryTab";
import BlocksTab from "./BlocksTab";
import BlockAddressDialog from "./BlockAddressDialog";
import ConnectionDetails from "./ConnectionDetails";
import type { OpenDetails, Selection } from "./selection";
import type { HistoryLink } from "./types";
import { useConnectionActions } from "./useConnectionActions";

const TABS = [
  { id: "live", label: "Live" },
  { id: "devices", label: "Devices" },
  { id: "history", label: "History" },
  { id: "blocks", label: "Blocked addresses" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function ConnectionsPanel() {
  const [tab, setTab] = useState<Tab>("live");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<HistoryScope>({});
  const actions = useConnectionActions();
  const { setNotice, blockAddress, closeBlock } = actions;
  const details = useDetails<Selection>();
  const selected = details.selected;

  // Counts for the tabs. These share the tabs' own subscriptions.
  const liveCount = useListConnectionsQuery().data?.connections.length;
  const deviceCount = useListSessionsQuery().data?.sessions.length;
  const blocks = useListIPBlocksQuery().data;
  const counts: Partial<Record<Tab, number>> = {
    live: liveCount,
    devices: deviceCount,
    blocks: blocks?.enabled ? blocks.blocks.length : undefined,
  };

  const openDetails: OpenDetails = details.open;

  const changeTab = (next: Tab) => {
    details.reset();
    setTab(next);
  };

  const showHistory: HistoryLink = (filter) => {
    setScope(filter);
    changeTab("history");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Connections</h2>
        {(tab === "live" || tab === "devices") && (
          <input
            type="search"
            className="input input-sm w-full sm:w-64"
            placeholder="Filter by user, address or country"
            aria-label="Filter by user, address or country"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </div>

      <div role="tablist" className="tabs tabs-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? "tab-active" : ""}`}
            onClick={() => changeTab(t.id)}
          >
            {t.label}
            {counts[t.id] !== undefined && (
              <span
                className="badge badge-ghost badge-sm ml-2"
                aria-hidden="true"
              >
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "live" && (
          <LiveTab
            search={search}
            onShowHistory={showHistory}
            onOpen={openDetails}
            openKey={selected?.key}
          />
        )}
        {tab === "devices" && (
          <DevicesTab
            search={search}
            onShowHistory={showHistory}
            onOpen={openDetails}
            openKey={selected?.key}
          />
        )}
        {tab === "history" && (
          <HistoryTab
            scope={scope}
            onScope={setScope}
            onClearScope={() => setScope({})}
            onOpen={openDetails}
            openKey={selected?.key}
          />
        )}
        {tab === "blocks" && <BlocksTab actions={actions} />}
      </div>

      {selected && (
        <ConnectionDetails
          key={selected.key}
          selection={selected}
          actions={actions}
          onShowHistory={showHistory}
          onClose={details.close}
        />
      )}

      {blockAddress !== null && (
        <BlockAddressDialog
          initialAddress={blockAddress}
          onClose={closeBlock}
          onDone={(n) => {
            closeBlock();
            setNotice(n);
          }}
        />
      )}
    </div>
  );
}
