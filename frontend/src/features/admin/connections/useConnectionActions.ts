import { useCallback, useState } from "react";
import { useAppSelector } from "@/app/store";
import {
  useDisconnectConnectionMutation,
  useRevokeSessionMutation,
  useSignOutUserMutation,
} from "@/features/admin/_shell";
import { KIND_LABELS } from "./format";
import type { ConnectionKind } from "@/types";

export interface Notice {
  kind: "success" | "error";
  text: string;
}

/** What a row needs to offer Disconnect. */
export interface DisconnectTarget {
  id: string;
  kind: ConnectionKind;
  username: string;
  self: boolean;
}

/** What a row needs to offer Sign out device. */
export interface DeviceTarget {
  familyId: string;
  username: string;
  current: boolean;
}

/** What a row needs to offer Sign out everywhere. */
export interface AccountTarget {
  userId: number;
  username: string;
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * The three things an admin can do to a connection or device. Each confirms
 * first, then reports the outcome through `notice`.
 */
export function useConnectionActions() {
  const myUsername = useAppSelector((s) => s.auth.username);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [disconnectOp] = useDisconnectConnectionMutation();
  const [revokeOp] = useRevokeSessionMutation();
  const [signOutOp] = useSignOutUserMutation();

  const disconnect = useCallback(
    async (t: DisconnectTarget) => {
      const who = t.username || "this anonymous listener";
      const question = t.self
        ? "Disconnect your own admin session? This page will reconnect."
        : `Disconnect ${who}'s ${KIND_LABELS[t.kind]} connection? A signed-in app or browser can reconnect straight away. To keep them out, sign the device out instead.`;
      if (!window.confirm(question)) return;
      try {
        await disconnectOp(t.id).unwrap();
        setNotice({ kind: "success", text: `Disconnected ${who}.` });
      } catch (e) {
        setNotice({
          kind: "error",
          text: messageOf(e, "Failed to disconnect."),
        });
      }
    },
    [disconnectOp],
  );

  const signOutDevice = useCallback(
    async (t: DeviceTarget) => {
      const question = t.current
        ? "Sign out the device you are using now? You will need to sign in again."
        : `Sign out this device of ${t.username}? It will need the password to sign in again.`;
      if (!window.confirm(question)) return;
      try {
        await revokeOp(t.familyId).unwrap();
        setNotice({
          kind: "success",
          text: `Signed out a device of ${t.username}.`,
        });
      } catch (e) {
        setNotice({
          kind: "error",
          text: messageOf(e, "Failed to sign out the device."),
        });
      }
    },
    [revokeOp],
  );

  const signOutEverywhere = useCallback(
    async (t: AccountTarget) => {
      const question =
        t.username === myUsername
          ? "Sign yourself out on every device, including this one?"
          : `Sign ${t.username} out on every device? They will need the password to sign in again.`;
      if (!window.confirm(question)) return;
      try {
        await signOutOp(t.userId).unwrap();
        setNotice({
          kind: "success",
          text: `Signed ${t.username} out on every device.`,
        });
      } catch (e) {
        setNotice({ kind: "error", text: messageOf(e, "Failed to sign out.") });
      }
    },
    [signOutOp, myUsername],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  // The address the Block dialog is open for; null = closed.
  const [blockAddress, setBlockAddress] = useState<string | null>(null);
  const openBlock = useCallback((address: string) => {
    setBlockAddress(address);
  }, []);
  const closeBlock = useCallback(() => setBlockAddress(null), []);

  return {
    notice,
    setNotice,
    clearNotice,
    blockAddress,
    openBlock,
    closeBlock,
    disconnect,
    signOutDevice,
    signOutEverywhere,
  };
}

export type ConnectionActions = ReturnType<typeof useConnectionActions>;
