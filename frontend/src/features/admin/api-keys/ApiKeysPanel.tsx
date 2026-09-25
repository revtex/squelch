import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  DataTable,
  FilterChips,
  PageHeader,
  SearchBox,
  formatAgo,
  useCreateApiKeyMutation,
  useDeleteApiKeyMutation,
  useDetails,
  useOpenParam,
  useGetConfigQuery,
  useListApiKeysQuery,
  useListSystemsQuery,
  useRotateApiKeyMutation,
  useToast,
  useUpdateApiKeyMutation,
  type Column,
} from "@/features/admin/_shell";
import type { AdminApiKey } from "@/types";
import ApiKeyDetails, { type KeyAction } from "./ApiKeyDetails";
import ApiKeyForm, { type ApiKeyFormValues } from "./ApiKeyForm";
import NewSecretPanel from "./NewSecretPanel";
import {
  keyName,
  keyStatus,
  matchesFilter,
  matchesSearch,
  systemsLabel,
  type StatusFilter,
} from "./keys";

type Panel =
  | { key: string; kind: "details"; id: number }
  | { key: string; kind: "edit"; id: number }
  | { key: string; kind: "create" }
  | {
      key: string;
      kind: "secret";
      /** Carried along so the secret shows before the list has refreshed. */
      apiKey: AdminApiKey;
      secret: string;
      previousUntil: number | null;
    };

const SERVER_DEFAULT_RATE = 60;

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** API keys: who may upload calls, and whether they still do. */
export default function ApiKeysPanel() {
  const { data: apiKeys, isLoading } = useListApiKeysQuery();
  const { data: systems } = useListSystemsQuery();
  const { data: config } = useGetConfigQuery();
  const [createKey] = useCreateApiKeyMutation();
  const [updateKey] = useUpdateApiKeyMutation();
  const [deleteKey] = useDeleteApiKeyMutation();
  const [rotateKey] = useRotateApiKeyMutation();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const panel = useDetails<Panel>();
  const keyIds = useMemo(() => apiKeys?.map((k) => k.id), [apiKeys]);
  useOpenParam(keyIds, (id) => panel.open({ key: `details:${id}`, kind: "details", id }));
  const p = panel.selected;

  const defaultRate = useMemo(() => {
    const raw = config?.settings?.find((s) => s.key === "apiKeyCallRate")?.value;
    const n = raw ? Number(raw) : NaN;
    return n > 0 ? n : SERVER_DEFAULT_RATE;
  }, [config]);

  const all = useMemo(
    () => (apiKeys ? [...apiKeys].sort((a, b) => a.order - b.order || a.id - b.id) : []),
    [apiKeys],
  );
  const systemList = useMemo(() => systems ?? [], [systems]);
  const rows = useMemo(
    () => all.filter((k) => matchesFilter(k, filter) && matchesSearch(k, systemList, query)),
    [all, filter, query, systemList],
  );
  const counts = useMemo(() => {
    const c = { all: all.length, active: 0, disabled: 0, legacy: 0, unused: 0 };
    for (const k of all) {
      if (k.disabled === 1) c.disabled++;
      else c.active++;
      if (k.legacy24h > 0) c.legacy++;
      if (k.lastUsedAt === null) c.unused++;
    }
    return c;
  }, [all]);

  const current = p && "id" in p ? (all.find((k) => k.id === p.id) ?? null) : null;

  const columns: Column<AdminApiKey>[] = [
    {
      id: "label",
      header: "Key",
      phone: "title",
      sortValue: (k) => keyName(k),
      cell: (k) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium">{keyName(k)}</span>
          <span className="font-mono text-xs text-base-content-dim">{k.fingerprint}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (k) => keyStatus(k).id,
      cell: (k) => {
        const s = keyStatus(k);
        return (
          <span className="flex flex-wrap gap-1">
            <span className={`badge badge-sm ${s.badge}`}>{s.label}</span>
            {k.legacy24h > 0 && (
              <span className="badge badge-warning badge-sm">legacy uploads</span>
            )}
          </span>
        );
      },
    },
    {
      id: "systems",
      header: "Systems",
      cell: (k) => systemsLabel(k, systemList),
    },
    {
      id: "rate",
      header: "Rate",
      align: "right",
      phone: "hide",
      sortValue: (k) => k.callRateLimit ?? defaultRate,
      cell: (k) => (k.callRateLimit != null ? `${k.callRateLimit}/min` : "default"),
    },
    {
      id: "calls",
      header: "Calls, 24 h",
      align: "right",
      sortValue: (k) => k.calls24h,
      cell: (k) => (k.calls24h > 0 ? k.calls24h.toLocaleString() : "—"),
    },
    {
      id: "lastUsed",
      header: "Last used",
      sortValue: (k) => k.lastUsedAt ?? 0,
      cell: (k) =>
        k.lastUsedAt ? (
          <span title={k.lastUsedIp ?? undefined}>{formatAgo(k.lastUsedAt)}</span>
        ) : (
          <span className="text-base-content-dim">never</span>
        ),
    },
  ];

  const openDetails = (k: AdminApiKey, trigger: HTMLElement) =>
    panel.open({ key: `details:${k.id}`, kind: "details", id: k.id }, trigger);

  const closeForm = () => {
    setFormError(null);
    panel.close();
  };

  const onCreate = async (values: ApiKeyFormValues) => {
    setBusy(true);
    setFormError(null);
    try {
      const { createdKey, ...created } = await createKey({ ...values, order: all.length }).unwrap();
      panel.replace({
        key: `secret:${created.id}`,
        kind: "secret",
        apiKey: created,
        secret: createdKey,
        previousUntil: null,
      });
    } catch (e) {
      setFormError(message(e, "Failed to create the key."));
    } finally {
      setBusy(false);
    }
  };

  const onUpdate = async (k: AdminApiKey, values: ApiKeyFormValues) => {
    setBusy(true);
    setFormError(null);
    try {
      await updateKey({ id: k.id, ...values, order: k.order }).unwrap();
      toast.success(`Saved ${values.ident || keyName(k)}.`);
      panel.replace({ key: `details:${k.id}`, kind: "details", id: k.id });
    } catch (e) {
      setFormError(message(e, "Failed to save the key."));
    } finally {
      setBusy(false);
    }
  };

  const act = async (k: AdminApiKey, action: KeyAction): Promise<string | null> => {
    setBusy(true);
    const name = keyName(k);
    try {
      switch (action) {
        case "disable":
        case "enable":
          await updateKey({
            id: k.id,
            ident: k.ident ?? "",
            disabled: action === "disable" ? 1 : 0,
            systemsJson: k.systemsJson,
            callRateLimit: k.callRateLimit,
            order: k.order,
          }).unwrap();
          toast.success(action === "disable" ? `Disabled ${name}.` : `Enabled ${name}.`);
          break;
        case "rotate": {
          const { createdKey, ...rotated } = await rotateKey(k.id).unwrap();
          panel.replace({
            key: `secret:${k.id}:${rotated.previousKeyExpiresAt ?? ""}`,
            kind: "secret",
            apiKey: rotated,
            secret: createdKey,
            previousUntil: rotated.previousKeyExpiresAt,
          });
          break;
        }
        case "delete":
          await deleteKey(k.id).unwrap();
          toast.success(`Deleted ${name}.`);
          break;
      }
      return null;
    } catch (e) {
      return message(e, "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="API keys"
        subtitle="What recorders use to upload calls. Each key can be limited to some systems and rate-limited."
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => panel.open({ key: "create", kind: "create" })}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add key
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          label="Search by label, fingerprint, system or address"
          className="w-full sm:w-80"
        />
        <FilterChips
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: counts.all },
            { id: "active", label: "Active", count: counts.active },
            { id: "disabled", label: "Disabled", count: counts.disabled },
            { id: "legacy", label: "Legacy uploads", count: counts.legacy },
            { id: "unused", label: "Never used", count: counts.unused },
          ]}
        />
      </div>

      <DataTable
        caption="API keys"
        columns={columns}
        rows={rows}
        rowKey={(k) => k.id}
        loading={isLoading}
        empty={
          all.length === 0
            ? "No keys yet. Add one and put its secret in your recorder."
            : "No key matches that search."
        }
        defaultSort={{ id: "label", dir: "asc" }}
        onOpen={openDetails}
        rowLabel={keyName}
        openKey={p?.kind === "details" ? p.id : null}
      />

      {p?.kind === "details" && current && (
        <ApiKeyDetails
          key={current.id}
          apiKey={current}
          systems={systemList}
          defaultRate={defaultRate}
          busy={busy}
          onEdit={() => panel.replace({ key: `edit:${current.id}`, kind: "edit", id: current.id })}
          onAction={(action) => act(current, action)}
          onClose={panel.close}
        />
      )}

      {p?.kind === "create" && (
        <ApiKeyForm
          apiKey={null}
          systems={systemList}
          defaultRate={defaultRate}
          busy={busy}
          error={formError}
          onSubmit={(values) => void onCreate(values)}
          onClose={closeForm}
        />
      )}

      {p?.kind === "edit" && current && (
        <ApiKeyForm
          key={current.id}
          apiKey={current}
          systems={systemList}
          defaultRate={defaultRate}
          busy={busy}
          error={formError}
          onSubmit={(values) => void onUpdate(current, values)}
          onClose={closeForm}
        />
      )}

      {p?.kind === "secret" && (
        <NewSecretPanel
          key={p.key}
          apiKey={p.apiKey}
          secret={p.secret}
          previousUntil={p.previousUntil}
          systems={systemList}
          onClose={panel.close}
        />
      )}
    </div>
  );
}
