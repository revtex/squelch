import { useSyncExternalStore } from "react";
import {
  adminWsClient,
  type AdminWsStatus,
} from "@/shared/services/ws/adminClient";

function subscribe(onChange: () => void): () => void {
  return adminWsClient.on("__status__", onChange);
}

function read(): AdminWsStatus {
  return adminWsClient.getStatus();
}

/** The admin socket's state, for the chrome to show. */
export function useAdminWsStatus(): AdminWsStatus {
  return useSyncExternalStore(subscribe, read, read);
}
