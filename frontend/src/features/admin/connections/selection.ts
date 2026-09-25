import type {
  AddressPlace,
  AdminConnection,
  AdminConnectionHistoryEntry,
  AdminSession,
  ConnectionKind,
} from "@/types";
import {
  KIND_LABELS,
  clientLabel,
  formatDateTime,
  formatDuration,
  reasonLabel,
} from "./format";
import type {
  AccountTarget,
  DeviceTarget,
  DisconnectTarget,
} from "./useConnectionActions";

/** One line of the details panel's fact list. */
export interface Fact {
  label: string;
  value: string;
}

/**
 * Everything the details panel shows about one row, captured when the row's
 * button is pressed. Each action is present only when the row supports it.
 */
export interface Selection {
  /** Unique across tabs, e.g. "live:c1"; marks the row as open. */
  key: string;
  title: string;
  anonymous: boolean;
  kind: ConnectionKind | null;
  role: string;
  /** One line under the title: what this row is. */
  subtitle: string;
  ip: string | null;
  place: AddressPlace;
  /** A country database is loaded, so the place is worth showing. */
  showCountry: boolean;
  trusted: boolean;
  /** The admin's own connection or device. */
  self: boolean;
  facts: Fact[];
  userId: number | null;
  disconnect?: DisconnectTarget;
  device?: DeviceTarget;
  account?: AccountTarget;
}

/** Opens the details panel; `trigger` gets focus back when it closes. */
export type OpenDetails = (selection: Selection, trigger: HTMLElement) => void;

function account(
  userId: number | null,
  username: string,
): AccountTarget | undefined {
  return userId !== null ? { userId, username } : undefined;
}

export function liveSelection(
  c: AdminConnection,
  now: number,
  showCountry: boolean,
): Selection {
  const anonymous = c.userId === null;
  const title = anonymous ? "Anonymous" : c.username;
  return {
    key: `live:${c.id}`,
    title,
    anonymous,
    kind: c.kind,
    role: c.role,
    subtitle: `Connected now · ${KIND_LABELS[c.kind]} · ${clientLabel(c.native)}`,
    ip: c.ip,
    place: c,
    showCountry,
    trusted: c.trusted,
    self: c.self,
    facts: [
      { label: "Client", value: clientLabel(c.native) },
      {
        label: "Connected",
        value: `${formatDuration(now - c.connectedAt)} ago (${formatDateTime(c.connectedAt)})`,
      },
      ...(c.userAgent ? [{ label: "User agent", value: c.userAgent }] : []),
    ],
    userId: c.userId,
    disconnect: { id: c.id, kind: c.kind, username: c.username, self: c.self },
    device: c.familyId
      ? { familyId: c.familyId, username: c.username, current: c.self }
      : undefined,
    account: account(c.userId, c.username),
  };
}

export function deviceSelection(
  s: AdminSession,
  showCountry: boolean,
): Selection {
  return {
    key: `device:${s.familyId}`,
    title: s.username,
    anonymous: false,
    kind: null,
    role: s.role,
    subtitle: `Signed-in device · ${clientLabel(s.native)} · ${s.liveConnections > 0 ? "online" : "offline"}`,
    ip: s.ip,
    place: s,
    showCountry,
    trusted: s.trusted,
    self: s.current,
    facts: [
      { label: "Client", value: clientLabel(s.native) },
      ...(s.signedInAt
        ? [{ label: "Signed in", value: formatDateTime(s.signedInAt) }]
        : []),
      { label: "Last used", value: formatDateTime(s.lastUsedAt) },
      ...(s.userAgent ? [{ label: "User agent", value: s.userAgent }] : []),
    ],
    userId: s.userId,
    device: {
      familyId: s.familyId,
      username: s.username,
      current: s.current,
    },
    account: account(s.userId, s.username),
  };
}

export function historySelection(
  e: AdminConnectionHistoryEntry,
  showCountry: boolean,
): Selection {
  const anonymous = e.userId === null;
  const username = e.username ?? `user #${e.userId}`;
  const ended =
    e.disconnectedAt === null
      ? "still connected"
      : reasonLabel(e.disconnectReason).toLowerCase() || "ended";
  return {
    key: `history:${e.id}`,
    title: anonymous ? "Anonymous" : username,
    anonymous,
    kind: e.kind,
    role: "",
    subtitle: `Past connection · ${KIND_LABELS[e.kind] ?? e.kind} · ${ended}`,
    ip: e.ip,
    place: e,
    showCountry,
    trusted: e.trusted,
    self: false,
    facts: [
      { label: "Client", value: clientLabel(e.native) },
      { label: "Connected", value: formatDateTime(e.connectedAt) },
      ...(e.disconnectedAt !== null
        ? [
            {
              label: "Lasted",
              value: formatDuration(e.disconnectedAt - e.connectedAt),
            },
          ]
        : []),
      ...(e.userAgent ? [{ label: "User agent", value: e.userAgent }] : []),
    ],
    userId: e.userId,
    // The server refuses these if the device or account is already gone.
    device: e.familyId
      ? { familyId: e.familyId, username, current: false }
      : undefined,
    account: account(e.userId, username),
  };
}
