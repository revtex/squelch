import { useWsQuery, useWsMutation, useLazyWsQuery } from "./useWsQuery";
import type {
  AdminUser,
  AdminSystem,
  AdminSystemInput,
  AdminTalkgroup,
  AdminTalkgroupInput,
  AdminUnit,
  AdminUnitInput,
  ImportMode,
  ImportRow,
  TalkgroupBulkPayload,
  TalkgroupImportResult,
  AdminGroup,
  AdminTag,
  DeleteLabelPayload,
  DeleteLabelResult,
  AdminApiKey,
  AdminApiKeyCreateResponse,
  AdminDirMonitor,
  AdminDirMonitorCreate,
  AdminDirMonitorUpdate,
  MaskTestResult,
  MonitorStatus,
  AdminDownstream,
  AdminDownstreamCreate,
  AdminDownstreamUpdate,
  AdminWebhook,
  AdminWebhookCreate,
  AdminWebhookUpdate,
  DeliveryResult,
  WebhookSample,
  ConfigResponse,
  AdminSetting,
  CreateUserPayload,
  UpdateUserPayload,
  SharedLinkAdmin,
  RestoreSharedLinkPayload,
  ServerDirectoryListResponse,
  BackupCounts,
  BackupPreview,
  ImportApplyResult,
  RestoreResult,
  UnitImportRow,
  TranscriptionStatus,
  AdminConnectionsList,
  AdminSessionsList,
  AdminConnectionHistoryPage,
  ConnectionHistoryFilter,
  AdminIPBlocksList,
  AdminLockoutsList,
  CreateIPBlockPayload,
  CreateIPBlockResult,
  TranscriptionModelsResponse,
  TranscriptionTestResult,
  TranscriptionJob,
  TranscriptionJobStatus,
  TranscriptionStats,
} from "@/types";

// ─── Payload types ──────────────────────────────────────────────────────────


type CreateApiKeyPayload = {
  ident: string | null;
  disabled: number;
  systemsJson: string | null;
  callRateLimit: number | null;
  order: number;
  key?: string | null;
};

type UpdateApiKeyPayload = {
  ident: string | null;
  disabled: number;
  systemsJson: string | null;
  callRateLimit: number | null;
  order: number;
  key?: string | null;
};

// ─── Connections ────────────────────────────────────────────────────────────

export function useListConnectionsQuery() {
  return useWsQuery<AdminConnectionsList>(
    "connections.list",
    undefined,
    "connections.updated",
  );
}

// Signing in opens a connection, so a change in connections is the cue to
// refresh the device list too.
export function useListSessionsQuery() {
  return useWsQuery<AdminSessionsList>(
    "sessions.list",
    undefined,
    "connections.updated",
  );
}

export function useConnectionHistoryQuery(filter: ConnectionHistoryFilter) {
  return useWsQuery<AdminConnectionHistoryPage>("connections.history", filter);
}

export function useDisconnectConnectionMutation() {
  return useWsMutation<void, string>("connections.disconnect", {
    transformArg: (id) => ({ id }),
  });
}

export function useRevokeSessionMutation() {
  return useWsMutation<void, string>("sessions.revoke", {
    transformArg: (familyId) => ({ familyId }),
  });
}

export function useListIPBlocksQuery() {
  return useWsQuery<AdminIPBlocksList>(
    "ipblocks.list",
    undefined,
    "ipblocks.updated",
  );
}

export function useCreateIPBlockMutation() {
  return useWsMutation<CreateIPBlockResult, CreateIPBlockPayload>(
    "ipblocks.create",
    { transformArg: (p) => ({ ...p }) },
  );
}

export function useDeleteIPBlockMutation() {
  return useWsMutation<void, number>("ipblocks.delete", {
    transformArg: (id) => ({ id }),
  });
}

export function useSignOutUserMutation() {
  return useWsMutation<void, number>("users.signout", {
    transformArg: (id) => ({ id }),
  });
}

// Lockouts are in memory on the server and end on their own, so poll.
export function useListLockoutsQuery() {
  return useWsQuery<AdminLockoutsList>(
    "lockouts.list",
    undefined,
    "lockouts.updated",
    30_000,
  );
}

export function useClearLockoutMutation() {
  return useWsMutation<void, string>("lockouts.clear", {
    transformArg: (ip) => ({ ip }),
  });
}

// ─── Users ──────────────────────────────────────────────────────────────────

export function useListUsersQuery() {
  return useWsQuery<AdminUser[]>("users.list", undefined, "users.updated");
}

export function useCreateUserMutation() {
  return useWsMutation<AdminUser, CreateUserPayload>("users.create");
}

export function useUpdateUserMutation() {
  return useWsMutation<AdminUser, { id: number } & UpdateUserPayload>(
    "users.update",
  );
}

export function useDeleteUserMutation() {
  return useWsMutation<void, number>("users.delete", {
    transformArg: (id) => ({ id }),
  });
}

// ─── Systems ────────────────────────────────────────────────────────────────

export function useListSystemsQuery() {
  return useWsQuery<AdminSystem[]>(
    "systems.list",
    undefined,
    "systems.updated",
  );
}

export function useCreateSystemMutation() {
  return useWsMutation<AdminSystem, AdminSystemInput>("systems.create");
}

export function useUpdateSystemMutation() {
  return useWsMutation<AdminSystem, AdminSystemInput & { id: number }>(
    "systems.update",
  );
}

export function useDeleteSystemMutation() {
  return useWsMutation<{ ok: boolean; talkgroups: number; units: number }, number>("systems.delete", {
    transformArg: (id) => ({ id }),
  });
}

export function useReorderSystemsMutation() {
  return useWsMutation<void, number[]>("systems.reorder", {
    transformArg: (ids) => ({ ids }),
  });
}

export function useBlockTalkgroupMutation() {
  return useWsMutation<{ ok: boolean; blocked: number[] }, { id: number; talkgroupId: number }>("systems.block");
}

export function useUnblockTalkgroupMutation() {
  return useWsMutation<{ ok: boolean; blocked: number[] }, { id: number; talkgroupId: number }>("systems.unblock");
}

// ─── Talkgroups ─────────────────────────────────────────────────────────────

/** All talkgroups, or one system's with their recent activity. */
export function useListTalkgroupsQuery(systemId?: number, options?: { skip?: boolean }) {
  return useWsQuery<AdminTalkgroup[]>(
    "talkgroups.list",
    systemId === undefined ? undefined : { systemId },
    "talkgroups.updated",
    undefined,
    options,
  );
}

export function useCreateTalkgroupMutation() {
  return useWsMutation<AdminTalkgroup, AdminTalkgroupInput>("talkgroups.create");
}

export function useUpdateTalkgroupMutation() {
  return useWsMutation<AdminTalkgroup, AdminTalkgroupInput & { id: number }>(
    "talkgroups.update",
  );
}

export function useDeleteTalkgroupMutation() {
  return useWsMutation<void, number>("talkgroups.delete", {
    transformArg: (id) => ({ id }),
  });
}

export function useDeleteTalkgroupsMutation() {
  return useWsMutation<{ ok: boolean; deleted: number }, number[]>("talkgroups.delete", {
    transformArg: (ids) => ({ ids }),
  });
}

export function useBulkTalkgroupsMutation() {
  return useWsMutation<{ ok: boolean; updated: number }, TalkgroupBulkPayload>("talkgroups.bulk");
}

export function useApplyTalkgroupImportMutation() {
  return useWsMutation<TalkgroupImportResult, { systemId: number; mode: ImportMode; rows: ImportRow[] }>(
    "talkgroups.import",
  );
}

export function useApplyUnitImportMutation() {
  return useWsMutation<ImportApplyResult, { systemId: number; mode: ImportMode; rows: UnitImportRow[] }>("units.import");
}

export function useApplyGroupImportMutation() {
  return useWsMutation<ImportApplyResult, { labels: string[] }>("groups.import");
}

export function useApplyTagImportMutation() {
  return useWsMutation<ImportApplyResult, { labels: string[] }>("tags.import");
}

// ─── Units ──────────────────────────────────────────────────────────────────

/** All units, or one system's with when each was last heard. */
export function useListUnitsQuery(systemId?: number, options?: { skip?: boolean }) {
  return useWsQuery<AdminUnit[]>(
    "units.list",
    systemId === undefined ? undefined : { systemId },
    "units.updated",
    undefined,
    options,
  );
}

export function useCreateUnitMutation() {
  return useWsMutation<AdminUnit, AdminUnitInput>("units.create");
}

export function useUpdateUnitMutation() {
  return useWsMutation<AdminUnit, AdminUnitInput & { id: number }>("units.update");
}

export function useDeleteUnitMutation() {
  return useWsMutation<void, number>("units.delete", {
    transformArg: (id) => ({ id }),
  });
}
// ─── Groups ─────────────────────────────────────────────────────────────────

export function useListGroupsQuery() {
  return useWsQuery<AdminGroup[]>("groups.list", undefined, "groups.updated");
}

export function useCreateGroupMutation() {
  return useWsMutation<AdminGroup, { label: string }>("groups.create");
}

export function useUpdateGroupMutation() {
  return useWsMutation<AdminGroup, { id: number; label: string }>("groups.update");
}

export function useDeleteGroupMutation() {
  return useWsMutation<DeleteLabelResult, DeleteLabelPayload>("groups.delete");
}

// ─── Tags ───────────────────────────────────────────────────────────────────

export function useListTagsQuery() {
  return useWsQuery<AdminTag[]>("tags.list", undefined, "tags.updated");
}

export function useCreateTagMutation() {
  return useWsMutation<AdminTag, { label: string }>("tags.create");
}

export function useUpdateTagMutation() {
  return useWsMutation<AdminTag, { id: number; label: string }>("tags.update");
}

export function useDeleteTagMutation() {
  return useWsMutation<DeleteLabelResult, DeleteLabelPayload>("tags.delete");
}

// ─── API Keys ───────────────────────────────────────────────────────────────

export function useListApiKeysQuery() {
  return useWsQuery<AdminApiKey[]>(
    "apikeys.list",
    undefined,
    "apikeys.updated",
  );
}

export function useCreateApiKeyMutation() {
  return useWsMutation<AdminApiKeyCreateResponse, CreateApiKeyPayload>(
    "apikeys.create",
  );
}

export function useUpdateApiKeyMutation() {
  return useWsMutation<AdminApiKey, { id: number } & UpdateApiKeyPayload>(
    "apikeys.update",
  );
}

export function useDeleteApiKeyMutation() {
  return useWsMutation<void, number>("apikeys.delete", {
    transformArg: (id) => ({ id }),
  });
}

/** Replaces the secret; the old one keeps working for a day. */
export function useRotateApiKeyMutation() {
  return useWsMutation<AdminApiKeyCreateResponse, number>("apikeys.rotate", {
    transformArg: (id) => ({ id }),
  });
}

// ─── DirMonitors ────────────────────────────────────────────────────────────

/** Polls every 15 s so the runtime state and last file stay fresh. */
export function useListDirMonitorsQuery() {
  return useWsQuery<AdminDirMonitor[]>(
    "dirmonitors.list",
    undefined,
    "dirmonitors.updated",
    15_000,
  );
}

export function useCreateDirMonitorMutation() {
  return useWsMutation<AdminDirMonitor, AdminDirMonitorCreate>("dirmonitors.create");
}

export function useUpdateDirMonitorMutation() {
  return useWsMutation<AdminDirMonitor, AdminDirMonitorUpdate>("dirmonitors.update");
}

export function useDeleteDirMonitorMutation() {
  return useWsMutation<void, number>("dirmonitors.delete", {
    transformArg: (id) => ({ id }),
  });
}

export function useRestartDirMonitorMutation() {
  return useWsMutation<{ ok: boolean; status: MonitorStatus }, number>("dirmonitors.restart", {
    transformArg: (id) => ({ id }),
  });
}

export function useTestMaskMutation() {
  return useWsMutation<MaskTestResult, { mask: string; filename: string }>(
    "dirmonitors.test-mask",
  );
}

export function useLazyListServerDirectoriesQuery() {
  return useLazyWsQuery<ServerDirectoryListResponse, { path: string }>(
    "fs.directories",
    { transformArg: (arg) => arg },
  );
}

// ─── Downstreams ────────────────────────────────────────────────────────────

export function useListDownstreamsQuery() {
  return useWsQuery<AdminDownstream[]>(
    "downstreams.list",
    undefined,
    "downstreams.updated",
  );
}

export function useCreateDownstreamMutation() {
  return useWsMutation<AdminDownstream, AdminDownstreamCreate>(
    "downstreams.create",
  );
}

export function useUpdateDownstreamMutation() {
  return useWsMutation<AdminDownstream, AdminDownstreamUpdate>(
    "downstreams.update",
  );
}

export function useDeleteDownstreamMutation() {
  return useWsMutation<void, number>("downstreams.delete", {
    transformArg: (id) => ({ id }),
  });
}

export function useTestDownstreamMutation() {
  return useWsMutation<DeliveryResult, number>("downstreams.test", {
    transformArg: (id) => ({ id }),
  });
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

export function useListWebhooksQuery() {
  return useWsQuery<AdminWebhook[]>(
    "webhooks.list",
    undefined,
    "webhooks.updated",
  );
}

export function useGetWebhookSampleQuery() {
  return useWsQuery<WebhookSample>("webhooks.sample");
}

export function useCreateWebhookMutation() {
  return useWsMutation<AdminWebhook, AdminWebhookCreate>("webhooks.create");
}

export function useUpdateWebhookMutation() {
  return useWsMutation<AdminWebhook, AdminWebhookUpdate>("webhooks.update");
}

export function useDeleteWebhookMutation() {
  return useWsMutation<void, number>("webhooks.delete", {
    transformArg: (id) => ({ id }),
  });
}

export function useTestWebhookMutation() {
  return useWsMutation<DeliveryResult, number>("webhooks.test", {
    transformArg: (id) => ({ id }),
  });
}

// ─── Config ─────────────────────────────────────────────────────────────────

export function useGetConfigQuery() {
  return useWsQuery<ConfigResponse>("config.get", undefined, "config.updated");
}

export function useUpdateConfigMutation() {
  return useWsMutation<void, AdminSetting[]>("config.update", {
    transformArg: (settings) => ({ settings }),
  });
}

// ─── Shared Links ───────────────────────────────────────────────────────────

export function useGetSharedLinksQuery() {
  return useWsQuery<SharedLinkAdmin[]>(
    "shared-links.list",
    undefined,
    "shared-links.updated",
  );
}

export function useDeleteSharedLinkMutation() {
  return useWsMutation<void, number>("shared-links.delete", {
    transformArg: (id) => ({ id }),
  });
}

/** Puts a just-revoked link back, same token, for an undo. */
export function useRestoreSharedLinkMutation() {
  return useWsMutation<{ restored: boolean }, RestoreSharedLinkPayload>(
    "shared-links.restore",
  );
}

export function useRevokeExpiredSharedLinksMutation() {
  return useWsMutation<{ revoked: number }, void>("shared-links.revoke-expired", {
    transformArg: () => ({}),
  });
}

// ─── Export / Import (non-file) ─────────────────────────────────────────────

export function useLazyExportConfigQuery() {
  return useLazyWsQuery<unknown, void>("export.config");
}

export function useLazyExportTalkgroupsQuery() {
  return useLazyWsQuery<string, { systemId?: number }>("export.talkgroups", {
    transformArg: (arg) => (arg as Record<string, unknown>) ?? {},
  });
}

export function useLazyExportUnitsQuery() {
  return useLazyWsQuery<string, { systemId?: number }>("export.units", {
    transformArg: (arg) => (arg as Record<string, unknown>) ?? {},
  });
}

export function useLazyExportGroupsQuery() {
  return useLazyWsQuery<string, void>("export.groups");
}

export function useLazyExportTagsQuery() {
  return useLazyWsQuery<string, void>("export.tags");
}

export function useImportConfigMutation() {
  // The restore request is the backup file itself with `mode` beside its
  // tables; the backend reads both from the one object.
  return useWsMutation<RestoreResult, Record<string, unknown>>("import.config");
}

export function useBackupPreviewMutation() {
  return useWsMutation<BackupPreview, Record<string, unknown>>("backup.preview");
}

export function useBackupCountsQuery() {
  return useWsQuery<BackupCounts>("backup.counts", undefined, "talkgroups.updated", 60_000);
}

// ─── RadioReference ─────────────────────────────────────────────────────────


// ─── Transcription ──────────────────────────────────────────────────────────

export function useTranscriptionStatusQuery() {
  return useWsQuery<TranscriptionStatus>("transcription.status", undefined, "transcription.updated", 30_000);
}

export function useTranscriptionModelsQuery() {
  return useWsQuery<TranscriptionModelsResponse>("transcription.models", undefined, "transcription.models.updated");
}

/** Starts a download; progress arrives as transcription.download.* events. */
export function useTranscriptionDownloadMutation() {
  return useWsMutation<{ started: boolean; model: string }, { model: string }>("transcription.download");
}

export function useCancelModelDownloadMutation() {
  return useWsMutation<{ cancelled: boolean }, { model: string }>("transcription.download.cancel");
}

export function useTranscriptionDeleteMutation() {
  return useWsMutation<{ deleted: boolean }, { id: string }>("transcription.delete");
}

export function useTranscriptionTestMutation() {
  return useWsMutation<TranscriptionTestResult, { url?: string }>("transcription.test");
}

export function useTranscriptionJobsQuery(status?: TranscriptionJobStatus, limit = 100) {
  return useWsQuery<TranscriptionJob[]>(
    "transcription.jobs",
    { status: status ?? "", limit },
    "transcription.jobs.updated",
    15_000,
  );
}

export function useRetryTranscriptionMutation() {
  return useWsMutation<{ ok: boolean; retried: number }, { callId?: number; callIds?: number[] }>("transcription.retry");
}

export function useTranscriptionStatsQuery() {
  return useWsQuery<TranscriptionStats>(
    "transcription.stats",
    undefined,
    "transcription.jobs.updated",
    30_000, // Auto-refresh every 30 seconds
  );
}

