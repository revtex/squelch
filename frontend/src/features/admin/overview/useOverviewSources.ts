// Gathers what the Overview, the sidebar counts and the top bar's ingest
// time are built from. The Shell calls it once and shares the result
// through OverviewDataContext, so every page fetches these lists once.
import { createContext, useContext, useMemo } from "react";
import { useGetLegacyUsageQuery } from "@/app/api";
import {
  useActivityStatsQuery,
  useGetConfigQuery,
  useHour12,
  useListApiKeysQuery,
  useListConnectionsQuery,
  useListDirMonitorsQuery,
  useListDownstreamsQuery,
  useListUsersQuery,
  useListWebhooksQuery,
  useNow,
  useTranscriptionStatsQuery,
} from "@/features/admin/_shell";
import { instanceState, useListTrInstancesQuery, useTrMqttState } from "@/features/admin/trunk-recorder";
import type { ActivityStats } from "@/types";
import {
  attentionItems,
  healthPills,
  navBadges,
  type AttentionItem,
  type HealthPill,
  type NavBadge,
  type OverviewSources,
} from "./attention";

export interface OverviewData {
  sources: OverviewSources;
  stats: ActivityStats | undefined;
  attention: AttentionItem[];
  pills: HealthPill[];
  badges: Record<string, NavBadge>;
  /** Unix seconds, ticking every 30 s. */
  now: number;
}

export function useOverviewSources(): OverviewData {
  const now = useNow(30_000);
  const hour12 = useHour12();
  const stats = useActivityStatsQuery().data;
  const monitors = useListDirMonitorsQuery().data;
  const downstreams = useListDownstreamsQuery().data;
  const webhooks = useListWebhooksQuery().data;
  const apiKeys = useListApiKeysQuery().data;
  const users = useListUsersQuery().data;
  const transcription = useTranscriptionStatsQuery().data;
  const config = useGetConfigQuery().data;
  const connections = useListConnectionsQuery().data;
  const legacy = useGetLegacyUsageQuery(undefined, { pollingInterval: 60_000, refetchOnFocus: true }).data;
  const tr = useListTrInstancesQuery();
  const live = useTrMqttState();

  const trInstances = useMemo(() => {
    // A 404 means the integration is off.
    if (tr.error) return null;
    return (tr.data ?? []).map((i) => ({
      id: i.id,
      label: i.label,
      enabled: i.enabled,
      state: instanceState(i, live.instances[i.id]),
    }));
  }, [tr.data, tr.error, live.instances]);

  const pruneRaw = config?.settings.find((s) => s.key === "pruneDays")?.value;
  const listeners = connections ? connections.connections.filter((c) => c.kind !== "admin").length : stats?.activeListeners;

  const sources = useMemo<OverviewSources>(
    () => ({
      now,
      hour12,
      monitors,
      downstreams,
      webhooks,
      legacy: legacy?.entries,
      apiKeys,
      users,
      transcription,
      storage: config?.storage,
      pruneDays: pruneRaw ? Number(pruneRaw) || 0 : undefined,
      trInstances,
      listeners,
      lastCallAt: stats?.lastCallAt,
    }),
    [now, hour12, monitors, downstreams, webhooks, legacy, apiKeys, users, transcription, config, pruneRaw, trInstances, listeners, stats],
  );

  return useMemo(() => {
    const attention = attentionItems(sources);
    return {
      sources,
      stats,
      attention,
      pills: healthPills(sources),
      badges: navBadges(sources, attention),
      now,
    };
  }, [sources, stats, now]);
}

export const OverviewDataContext = createContext<OverviewData | null>(null);

/** The Shell's shared Overview data; outside the Shell it is null. */
export function useOverviewData(): OverviewData | null {
  return useContext(OverviewDataContext);
}
