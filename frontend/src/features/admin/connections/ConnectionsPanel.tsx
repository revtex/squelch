import { useState } from "react";
import { X } from "lucide-react";
import LiveTab from "./LiveTab";
import DevicesTab from "./DevicesTab";
import HistoryTab, { type HistoryScope } from "./HistoryTab";
import BlocksTab from "./BlocksTab";
import BlockAddressDialog from "./BlockAddressDialog";
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
  const [tab, setTab] = useState<Tab>("live");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<HistoryScope>({});
  const actions = useConnectionActions();
  const { notice, clearNotice, setNotice, blockAddress, closeBlock } = actions;

  const showHistory: HistoryLink = (filter) => {
    setScope(filter);
    setTab("history");
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

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`alert ${notice.kind === "error" ? "alert-error" : "alert-success"}`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            aria-label="Dismiss"
            onClick={clearNotice}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <div role="tablist" className="tabs tabs-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? "tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "live" && (
          <LiveTab
            search={search}
            onShowHistory={showHistory}
            actions={actions}
          />
        )}
        {tab === "devices" && (
          <DevicesTab
            search={search}
            onShowHistory={showHistory}
            actions={actions}
          />
        )}
        {tab === "history" && (
          <HistoryTab
            scope={scope}
            onScope={setScope}
            onClearScope={() => setScope({})}
            actions={actions}
          />
        )}
        {tab === "blocks" && <BlocksTab actions={actions} />}
      </div>

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
