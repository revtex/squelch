import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  COUNT,
  PageHeader,
  SearchBox,
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
  { id: "devices", label: "Signed-in devices" },
  { id: "history", label: "History" },
  { id: "blocks", label: "Blocked addresses" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function ConnectionsPanel() {
  // Users links here with ?user=<id>&name=<username> to show one account's
  // history, or with ?tab=live|devices&q=<text> to open a tab filtered.
  const [params] = useSearchParams();
  const linkedTab = TABS.find((t) => t.id === params.get("tab"))?.id;
  const linkedUser = Number(params.get("user"));
  const linked: HistoryScope | null =
    linkedUser > 0
      ? { userId: linkedUser, label: params.get("name") ?? `user #${linkedUser}` }
      : null;
  const [tab, setTab] = useState<Tab>(linkedTab ?? (linked ? "history" : "live"));
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [scope, setScope] = useState<HistoryScope>(linked ?? {});
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
    <div className="flex flex-col gap-[18px]">
      <PageHeader
        title="Connections"
        subtitle="Who is listening right now, which devices can sign back in, and what has been blocked."
      />

      <div role="tablist" className="tabs tabs-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab gap-2 ${tab === t.id ? "tab-active" : ""}`}
            onClick={() => changeTab(t.id)}
          >
            {t.label}
            {counts[t.id] !== undefined && (
              <span className={COUNT} aria-hidden="true">
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {(tab === "live" || tab === "devices") && (
        <SearchBox
          label="Filter by user, address or country"
          value={search}
          onChange={setSearch}
          className="w-full md:max-w-[340px]"
        />
      )}

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
