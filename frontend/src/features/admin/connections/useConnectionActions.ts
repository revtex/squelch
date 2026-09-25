import { useCallback, useState } from "react";
import { useAppSelector } from "@/app/store";
import {
  useDisconnectConnectionMutation,
  useRevokeSessionMutation,
  useSignOutUserMutation,
} from "@/features/admin/_shell";
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
 * The three things an admin can do to a connection or device. The caller
 * confirms first; each reports its outcome through `notice` and resolves to
 * the error message, or null when it worked.
 */
export function useConnectionActions() {
  const myUsername = useAppSelector((s) => s.auth.username);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [disconnectOp] = useDisconnectConnectionMutation();
  const [revokeOp] = useRevokeSessionMutation();
  const [signOutOp] = useSignOutUserMutation();

  const disconnect = useCallback(
    async (t: DisconnectTarget): Promise<string | null> => {
      const who = t.username || "the anonymous listener";
      try {
        await disconnectOp(t.id).unwrap();
        setNotice({ kind: "success", text: `Disconnected ${who}.` });
        return null;
      } catch (e) {
        const text = messageOf(e, "Failed to disconnect.");
        setNotice({ kind: "error", text });
        return text;
      }
    },
    [disconnectOp],
  );

  const signOutDevice = useCallback(
    async (t: DeviceTarget): Promise<string | null> => {
      try {
        await revokeOp(t.familyId).unwrap();
        setNotice({
          kind: "success",
          text: `Signed out a device of ${t.username}.`,
        });
        return null;
      } catch (e) {
        const text = messageOf(e, "Failed to sign out the device.");
        setNotice({ kind: "error", text });
        return text;
      }
    },
    [revokeOp],
  );

  const signOutEverywhere = useCallback(
    async (t: AccountTarget): Promise<string | null> => {
      try {
        await signOutOp(t.userId).unwrap();
        setNotice({
          kind: "success",
          text: `Signed ${t.username} out on every device.`,
        });
        return null;
      } catch (e) {
        const text = messageOf(e, "Failed to sign out.");
        setNotice({ kind: "error", text });
        return text;
      }
    },
    [signOutOp],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  // The address the Block dialog is open for; null = closed.
  const [blockAddress, setBlockAddress] = useState<string | null>(null);
  const openBlock = useCallback((address: string) => {
    setBlockAddress(address);
  }, []);
  const closeBlock = useCallback(() => setBlockAddress(null), []);

  return {
    myUsername,
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
