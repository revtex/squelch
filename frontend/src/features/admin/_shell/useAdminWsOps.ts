import { useWsQuery, useWsMutation, useLazyWsQuery } from "./useWsQuery";
import type {
  AdminUser,
  AdminSystem,
  AdminTalkgroup,
  AdminUnit,
  AdminGroup,
  AdminTag,
  DeleteLabelPayload,
  DeleteLabelResult,
  AdminApiKey,
  AdminApiKeyCreateResponse,
  AdminDirMonitor,
  AdminDownstream,
  AdminDownstreamCreate,
  AdminDownstreamUpdate,
  AdminWebhook,
  ConfigResponse,
  AdminSetting,
  CreateUserPayload,
  UpdateUserPayload,
  SharedLinkAdmin,
  ServerDirectoryListResponse,
  RRApplyRequest,
  RRApplyResponse,
  TranscriptionStatus,
  WhisperModel,
  AdminConnectionsList,
  AdminSessionsList,
  AdminConnectionHistoryPage,
  ConnectionHistoryFilter,
  AdminIPBlocksList,
  AdminLockoutsList,
  CreateIPBlockPayload,
  CreateIPBlockResult,
} from "@/types";

// ─── Payload types ──────────────────────────────────────────────────────────

type CreatePayload<T> = Omit<T, "id">;
type UpdatePayload<T> = { id: number } & Partial<Omit<T, "id">>;

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
  return useWsMutation<AdminSystem, CreatePayload<AdminSystem>>(
    "systems.create",
  );
}

export function useUpdateSystemMutation() {
  return useWsMutation<AdminSystem, UpdatePayload<AdminSystem>>(
    "systems.update",
  );
}

export function useDeleteSystemMutation() {
  return useWsMutation<void, number>("systems.delete", {
    transformArg: (id) => ({ id }),
  });
}

// ─── Talkgroups ─────────────────────────────────────────────────────────────

export function useListTalkgroupsQuery() {
  return useWsQuery<AdminTalkgroup[]>(
    "talkgroups.list",
    undefined,
    "talkgroups.updated",
  );
}

export function useCreateTalkgroupMutation() {
  return useWsMutation<AdminTalkgroup, CreatePayload<AdminTalkgroup>>(
    "talkgroups.create",
  );
}

export function useUpdateTalkgroupMutation() {
  return useWsMutation<AdminTalkgroup, UpdatePayload<AdminTalkgroup>>(
    "talkgroups.update",
  );
}

export function useDeleteTalkgroupMutation() {
  return useWsMutation<void, number>("talkgroups.delete", {
    transformArg: (id) => ({ id }),
  });
}

// ─── Units ──────────────────────────────────────────────────────────────────

export function useListUnitsQuery() {
  return useWsQuery<AdminUnit[]>("units.list", undefined, "units.updated");
}

export function useCreateUnitMutation() {
  return useWsMutation<AdminUnit, CreatePayload<AdminUnit>>("units.create");
}

export function useUpdateUnitMutation() {
  return useWsMutation<AdminUnit, UpdatePayload<AdminUnit>>("units.update");
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

export function useListDirMonitorsQuery() {
  return useWsQuery<AdminDirMonitor[]>(
    "dirmonitors.list",
    undefined,
    "dirmonitors.updated",
  );
}

export function useCreateDirMonitorMutation() {
  return useWsMutation<AdminDirMonitor, CreatePayload<AdminDirMonitor>>(
    "dirmonitors.create",
  );
}

export function useUpdateDirMonitorMutation() {
  return useWsMutation<AdminDirMonitor, UpdatePayload<AdminDirMonitor>>(
    "dirmonitors.update",
  );
}

export function useDeleteDirMonitorMutation() {
  return useWsMutation<void, number>("dirmonitors.delete", {
    transformArg: (id) => ({ id }),
  });
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

// ─── Webhooks ───────────────────────────────────────────────────────────────

export function useListWebhooksQuery() {
  return useWsQuery<AdminWebhook[]>(
    "webhooks.list",
    undefined,
    "webhooks.updated",
  );
}

export function useCreateWebhookMutation() {
  return useWsMutation<AdminWebhook, CreatePayload<AdminWebhook>>(
    "webhooks.create",
  );
}

export function useUpdateWebhookMutation() {
  return useWsMutation<AdminWebhook, UpdatePayload<AdminWebhook>>(
    "webhooks.update",
  );
}

export function useDeleteWebhookMutation() {
  return useWsMutation<void, number>("webhooks.delete", {
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
  return useWsMutation<void, unknown>("import.config", {
    // The backup file IS the params object — the backend unmarshals
    // params directly into a struct with top-level settings/groups/
    // systems/etc. fields. Wrapping it as { data } here would put
    // everything one level too deep and silently parse zero entities.
    transformArg: (data) => data as Record<string, unknown>,
  });
}

// ─── RadioReference ─────────────────────────────────────────────────────────

export function useRrApplyMutation() {
  return useWsMutation<RRApplyResponse, RRApplyRequest>("radioreference.apply");
}

// ─── Transcription ──────────────────────────────────────────────────────────

export function useTranscriptionStatusQuery() {
  return useWsQuery<TranscriptionStatus>("transcription.status");
}

export function useTranscriptionModelsQuery() {
  return useWsQuery<WhisperModel[]>("transcription.models");
}

export function useTranscriptionDownloadMutation() {
  return useWsMutation<WhisperModel, { model: string }>(
    "transcription.download",
    { timeoutMs: 5 * 60_000 },
  );
}

export function useTranscriptionDeleteMutation() {
  return useWsMutation<{ deleted: boolean }, { id: string }>(
    "transcription.delete",
  );
}

export function useTranscriptionStatsQuery() {
  return useWsQuery<import("@/types").TranscriptionStats>(
    "transcription.stats",
    undefined,
    undefined,
    30_000, // Auto-refresh every 30 seconds
  );
}
