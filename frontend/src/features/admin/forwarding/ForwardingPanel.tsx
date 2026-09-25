import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  DataTable,
  FilterChips,
  PageHeader,
  SearchBox,
  formatAgo,
  useCreateDownstreamMutation,
  useCreateWebhookMutation,
  useDeleteDownstreamMutation,
  useDeleteWebhookMutation,
  useDetails,
  useOpenParam,
  useGetWebhookSampleQuery,
  useListDownstreamsQuery,
  useListSystemsQuery,
  useListWebhooksQuery,
  useTestDownstreamMutation,
  useTestWebhookMutation,
  useToast,
  useUpdateDownstreamMutation,
  useUpdateWebhookMutation,
  type Column,
} from "@/features/admin/_shell";
import type { AdminDownstream, AdminWebhook, ForwardingTarget } from "@/types";
import DownstreamForm, { type DownstreamFormValues } from "./DownstreamForm";
import TargetDetails, { type TargetAction } from "./TargetDetails";
import WebhookForm, { type WebhookFormValues } from "./WebhookForm";
import {
  TABS,
  deliveryState,
  matchesFilter,
  matchesSearch,
  systemsLabel,
  tabFrom,
  targetName,
  type StatusFilter,
  type Tab,
} from "./targets";

type Panel =
  | { key: string; kind: "details"; id: number }
  | { key: string; kind: "edit"; id: number }
  | { key: string; kind: "create" };

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Forwarding: the other servers and webhooks that get a copy of each call. */
export default function ForwardingPanel() {
  const [search, setSearch] = useSearchParams();
  const tab = tabFrom(search.get("tab"));
  const { data: downstreams, isLoading: loadingDownstreams } = useListDownstreamsQuery();
  const { data: webhooks, isLoading: loadingWebhooks } = useListWebhooksQuery();
  const { data: systems } = useListSystemsQuery();
  const { data: sample } = useGetWebhookSampleQuery();
  const [createDownstream] = useCreateDownstreamMutation();
  const [updateDownstream] = useUpdateDownstreamMutation();
  const [deleteDownstream] = useDeleteDownstreamMutation();
  const [testDownstream] = useTestDownstreamMutation();
  const [createWebhook] = useCreateWebhookMutation();
  const [updateWebhook] = useUpdateWebhookMutation();
  const [deleteWebhook] = useDeleteWebhookMutation();
  const [testWebhook] = useTestWebhookMutation();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const panel = useDetails<Panel>();
  const targetIds = useMemo(
    () => (tab === "downstreams" ? downstreams : webhooks)?.map((t) => t.id),
    [tab, downstreams, webhooks],
  );
  useOpenParam(targetIds, (id) => panel.open({ key: `${tab}:details:${id}`, kind: "details", id }));
  const p = panel.selected;

  const systemList = useMemo(() => systems ?? [], [systems]);
  const all = useMemo<ForwardingTarget[]>(() => {
    const rows: ForwardingTarget[] = tab === "downstreams" ? (downstreams ?? []) : (webhooks ?? []);
    return [...rows].sort((a, b) => a.order - b.order || a.id - b.id);
  }, [tab, downstreams, webhooks]);
  const rows = useMemo(
    () => all.filter((t) => matchesFilter(t, filter) && matchesSearch(t, systemList, query)),
    [all, filter, query, systemList],
  );
  const counts = useMemo(() => {
    const c = { all: all.length, active: 0, failing: 0, disabled: 0 };
    for (const t of all) {
      const s = deliveryState(t).id;
      if (s === "disabled") c.disabled++;
      else c.active++;
      if (s === "failing") c.failing++;
    }
    return c;
  }, [all]);
  const isLoading = tab === "downstreams" ? loadingDownstreams : loadingWebhooks;
  const kindLabel = tab === "downstreams" ? "Downstream" : "Webhook";

  const currentDownstream =
    tab === "downstreams" && p && "id" in p
      ? ((downstreams ?? []).find((d) => d.id === p.id) ?? null)
      : null;
  const currentWebhook =
    tab === "webhooks" && p && "id" in p
      ? ((webhooks ?? []).find((w) => w.id === p.id) ?? null)
      : null;
  const current: ForwardingTarget | null = currentDownstream ?? currentWebhook;

  const selectTab = (next: Tab) => {
    panel.reset();
    setQuery("");
    setFilter("all");
    const params = new URLSearchParams(search);
    if (next === "downstreams") params.delete("tab");
    else params.set("tab", next);
    setSearch(params, { replace: true });
  };

  const columns: Column<ForwardingTarget>[] = [
    {
      id: "label",
      header: kindLabel,
      phone: "title",
      sortValue: targetName,
      cell: (t) => (
        <span className="flex flex-col">
          <span className="font-medium">{targetName(t)}</span>
          <span className="truncate font-mono text-xs text-base-content-dim">{t.url}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (t) => deliveryState(t).id,
      cell: (t) => {
        const s = deliveryState(t);
        return (
          <span className="flex flex-col gap-0.5">
            <span className={`badge badge-sm ${s.badge}`}>{s.label}</span>
            {s.id === "failing" && t.last && (
              <span className="text-xs text-error">{t.last.error || `status ${t.last.status}`}</span>
            )}
          </span>
        );
      },
    },
    ...(tab === "webhooks"
      ? [
          {
            id: "type",
            header: "Type",
            phone: "hide",
            sortValue: (t: ForwardingTarget) => (t as AdminWebhook).type,
            cell: (t: ForwardingTarget) =>
              (t as AdminWebhook).type === "discord" ? "Discord" : "Generic",
          } satisfies Column<ForwardingTarget>,
        ]
      : []),
    {
      id: "systems",
      header: "Systems",
      phone: "hide",
      cell: (t) => systemsLabel(t, systemList),
    },
    {
      id: "last",
      header: "Last delivery",
      sortValue: (t) => t.last?.at ?? 0,
      cell: (t) =>
        t.last ? (
          formatAgo(t.last.at)
        ) : (
          <span className="text-base-content-dim">never</span>
        ),
    },
    {
      id: "failed",
      header: "Failed, 24 h",
      align: "right",
      sortValue: (t) => t.failed24h,
      cell: (t) =>
        t.failed24h > 0 ? (
          <span className="text-error">{t.failed24h.toLocaleString()}</span>
        ) : (
          "—"
        ),
    },
  ];

  const openDetails = (t: ForwardingTarget, trigger: HTMLElement) =>
    panel.open({ key: `${tab}:details:${t.id}`, kind: "details", id: t.id }, trigger);

  const closeForm = () => {
    setFormError(null);
    panel.close();
  };

  const withBusy = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
    } catch (e) {
      setFormError(message(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const onCreateDownstream = (values: DownstreamFormValues) =>
    withBusy(async () => {
      const created = await createDownstream({ ...values, order: all.length }).unwrap();
      toast.success(`Added ${targetName(created)}.`);
      panel.replace({ key: `downstreams:details:${created.id}`, kind: "details", id: created.id });
    }, "Failed to add the downstream.");

  const onUpdateDownstream = (d: AdminDownstream, values: DownstreamFormValues) =>
    withBusy(async () => {
      await updateDownstream({ id: d.id, ...values, order: d.order }).unwrap();
      toast.success(`Saved ${values.label || targetName(d)}.`);
      panel.replace({ key: `downstreams:details:${d.id}`, kind: "details", id: d.id });
    }, "Failed to save the downstream.");

  const onCreateWebhook = (values: WebhookFormValues) =>
    withBusy(async () => {
      const created = await createWebhook({ ...values, order: all.length }).unwrap();
      toast.success(`Added ${targetName(created)}.`);
      panel.replace({ key: `webhooks:details:${created.id}`, kind: "details", id: created.id });
    }, "Failed to add the webhook.");

  const onUpdateWebhook = (w: AdminWebhook, values: WebhookFormValues) =>
    withBusy(async () => {
      await updateWebhook({ id: w.id, ...values, order: w.order }).unwrap();
      toast.success(`Saved ${values.label || targetName(w)}.`);
      panel.replace({ key: `webhooks:details:${w.id}`, kind: "details", id: w.id });
    }, "Failed to save the webhook.");

  const act = async (t: ForwardingTarget, action: TargetAction): Promise<string | null> => {
    setBusy(true);
    const name = targetName(t);
    try {
      if (action === "delete") {
        if (tab === "downstreams") await deleteDownstream(t.id).unwrap();
        else await deleteWebhook(t.id).unwrap();
        toast.success(`Deleted ${name}.`);
        return null;
      }
      const disabled = action === "disable" ? 1 : 0;
      if (currentDownstream) {
        await updateDownstream({
          id: t.id,
          label: t.label,
          url: t.url,
          apiKey: "",
          systemsJson: t.systemsJson,
          disabled,
          order: t.order,
        }).unwrap();
      } else if (currentWebhook) {
        await updateWebhook({
          id: t.id,
          label: t.label,
          url: t.url,
          type: currentWebhook.type,
          systemsJson: t.systemsJson,
          disabled,
          order: t.order,
        }).unwrap();
      }
      toast.success(action === "disable" ? `Disabled ${name}.` : `Enabled ${name}.`);
      return null;
    } catch (e) {
      return message(e, "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const test = (t: ForwardingTarget) =>
    tab === "downstreams" ? testDownstream(t.id).unwrap() : testWebhook(t.id).unwrap();

  const emptyText =
    tab === "downstreams"
      ? "No downstreams yet. Add one to send a copy of every call to another Squelch server."
      : "No webhooks yet. Add one to notify a service or a Discord channel of every call.";

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="Forwarding"
        subtitle="Where a copy of each new call goes: other Squelch servers, and webhooks that notify a service or a Discord channel."
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => panel.open({ key: `${tab}:create`, kind: "create" })}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {tab === "downstreams" ? "Add downstream" : "Add webhook"}
          </button>
        }
      />

      <div role="tablist" aria-label="Forwarding kind" className="tabs tabs-border">
        {TABS.map((t) => {
          const count = t.id === "downstreams" ? downstreams?.length : webhooks?.length;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              className={`tab ${t.id === tab ? "tab-active" : ""}`}
              onClick={() => selectTab(t.id)}
            >
              {t.label}
              {count !== undefined && (
                <span className="badge badge-ghost badge-sm ml-2">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          label="Search by label, address or system"
          className="w-full sm:w-80"
        />
        <FilterChips
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: counts.all },
            { id: "active", label: "Active", count: counts.active },
            { id: "failing", label: "Failing", count: counts.failing },
            { id: "disabled", label: "Disabled", count: counts.disabled },
          ]}
        />
      </div>

      <DataTable
        key={tab}
        caption={tab === "downstreams" ? "Downstreams" : "Webhooks"}
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        loading={isLoading}
        empty={all.length === 0 ? emptyText : "Nothing matches that search."}
        defaultSort={{ id: "label", dir: "asc" }}
        onOpen={openDetails}
        rowLabel={targetName}
        openKey={p?.kind === "details" ? p.id : null}
      />

      {p?.kind === "details" && current && (
        <TargetDetails
          key={p.key}
          target={current}
          kindLabel={kindLabel}
          systems={systemList}
          extraFacts={
            currentDownstream
              ? [{ label: "API key", value: currentDownstream.hasApiKey ? "Set" : "Not set" }]
              : currentWebhook
                ? [
                    {
                      label: "Type",
                      value: currentWebhook.type === "discord" ? "Discord" : "Generic JSON",
                    },
                    {
                      label: "Secret",
                      value: currentWebhook.hasSecret ? "Set, posts are signed" : "Not set",
                    },
                  ]
                : []
          }
          busy={busy}
          onEdit={() => panel.replace({ key: `${tab}:edit:${current.id}`, kind: "edit", id: current.id })}
          onTest={() => test(current)}
          onAction={(action) => act(current, action)}
          onClose={panel.close}
        >
          {currentWebhook?.type === "generic" && sample && (
            <details className="collapse collapse-arrow border border-admin-line bg-base-200">
              <summary className="collapse-title text-sm font-medium">
                What your service receives
              </summary>
              <div className="collapse-content space-y-2 text-xs">
                <p className="text-base-content-dim">
                  One POST per call, with these headers and a JSON body like this one.
                </p>
                <pre className="overflow-x-auto rounded bg-base-300 p-2 font-mono">
                  {Object.entries(sample.headers)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join("\n")}
                </pre>
                <pre className="overflow-x-auto rounded bg-base-300 p-2 font-mono">
                  {JSON.stringify(sample.payload, null, 2)}
                </pre>
              </div>
            </details>
          )}
        </TargetDetails>
      )}

      {tab === "downstreams" && p?.kind === "create" && (
        <DownstreamForm
          downstream={null}
          systems={systemList}
          busy={busy}
          error={formError}
          onSubmit={(values) => void onCreateDownstream(values)}
          onClose={closeForm}
        />
      )}
      {tab === "downstreams" && p?.kind === "edit" && currentDownstream && (
        <DownstreamForm
          key={currentDownstream.id}
          downstream={currentDownstream}
          systems={systemList}
          busy={busy}
          error={formError}
          onSubmit={(values) => void onUpdateDownstream(currentDownstream, values)}
          onClose={closeForm}
        />
      )}
      {tab === "webhooks" && p?.kind === "create" && (
        <WebhookForm
          webhook={null}
          systems={systemList}
          busy={busy}
          error={formError}
          onSubmit={(values) => void onCreateWebhook(values)}
          onClose={closeForm}
        />
      )}
      {tab === "webhooks" && p?.kind === "edit" && currentWebhook && (
        <WebhookForm
          key={currentWebhook.id}
          webhook={currentWebhook}
          systems={systemList}
          busy={busy}
          error={formError}
          onSubmit={(values) => void onUpdateWebhook(currentWebhook, values)}
          onClose={closeForm}
        />
      )}
    </div>
  );
}
