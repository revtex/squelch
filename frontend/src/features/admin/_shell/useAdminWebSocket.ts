import { useEffect, useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/app/store";
import { adminWsClient } from "@/shared/services/ws/adminClient";
import { setCredentials, usePostRefreshMutation } from "@/features/auth";
import { api } from "@/app/api";
import { applyTrEvent } from "@/features/admin/trunk-recorder";
import type { TrEventEnvelope } from "@/features/admin/trunk-recorder";

export function useAdminWebSocket(): void {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.auth.token);
  const role = useAppSelector((s) => s.auth.role);
  const [postRefresh] = usePostRefreshMutation();

  const handleTokenExpired = useCallback(async (): Promise<string | null> => {
    try {
      const { token: newToken, user } = await postRefresh().unwrap();
      dispatch(
        setCredentials({
          token: newToken,
          role: user.role,
          username: user.username,
          passwordNeedChange: false,
        }),
      );
      return newToken;
    } catch {
      return null;
    }
  }, [dispatch, postRefresh]);

  useEffect(() => {
    adminWsClient.onTokenExpired(handleTokenExpired);
  }, [handleTokenExpired]);

  // Connect when admin is authenticated
  useEffect(() => {
    if (!token || role !== "admin") return;

    adminWsClient.connect(dispatch, token);

    return () => {
      adminWsClient.disconnect();
    };
  }, [dispatch, token, role]);

  // Listen for admin events and invalidate RTK Query caches
  useEffect(() => {
    const unsubscribe = adminWsClient.onAny(
      (topic: string, data: unknown, at: number) => {
        // tr.* events feed the Trunk Recorder slice (no RTK invalidation).
        if (topic.startsWith("tr.")) {
          dispatch(
            applyTrEvent({
              topic,
              envelope: data as TrEventEnvelope,
              at,
            }),
          );
          return;
        }

        const tagMap: Record<string, string[]> = {
          "systems.updated": ["Systems"],
          "talkgroups.updated": ["Talkgroups"],
          "units.updated": ["Units"],
          "users.updated": ["Users"],
          "groups.updated": ["Groups"],
          "tags.updated": ["Tags"],
          "apikeys.updated": ["ApiKeys"],
          "dirmonitors.updated": ["DirMonitors"],
          "downstreams.updated": ["Downstreams"],
          "webhooks.updated": ["Webhooks"],
          "config.updated": ["Config"],
          "shared-links.updated": ["SharedLinks"],
        };

        const tags = tagMap[topic];
        if (tags) {
          dispatch(
            api.util.invalidateTags(
              tags.map((tag) => ({ type: tag as never })),
            ),
          );
        }
      },
    );

    return unsubscribe;
  }, [dispatch]);
}
