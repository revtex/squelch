import type { AdminSystem, AdminUser } from "@/types";

export type UserStatusId = "active" | "disabled" | "expired";

export interface UserStatus {
  id: UserStatusId;
  label: string;
  badge: string;
}

/** Disabled beats expired beats active; a temporary password is separate. */
export function userStatus(u: AdminUser, now = Date.now() / 1000): UserStatus {
  if (u.disabled === 1) {
    return { id: "disabled", label: "Disabled", badge: "badge-ghost" };
  }
  if (u.expiration !== null && u.expiration < now) {
    return { id: "expired", label: "Expired", badge: "badge-warning" };
  }
  return { id: "active", label: "Active", badge: "badge-success" };
}

export type StatusFilter = "all" | UserStatusId | "temporary";

export function matchesStatus(
  u: AdminUser,
  filter: StatusFilter,
  now = Date.now() / 1000,
): boolean {
  if (filter === "all") return true;
  if (filter === "temporary") return u.passwordNeedChange === 1;
  return userStatus(u, now).id === filter;
}

/** The system ids a user is limited to; empty means every system. */
export function allowedSystemIds(u: AdminUser): number[] {
  if (!u.systemsJson) return [];
  try {
    const parsed: unknown = JSON.parse(u.systemsJson);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is number => typeof x === "number")
      : [];
  } catch {
    return [];
  }
}

/** "All systems", or the names of the ones allowed. */
export function systemsLabel(u: AdminUser, systems: AdminSystem[]): string {
  const ids = allowedSystemIds(u);
  if (ids.length === 0) return "All systems";
  const names = ids.map(
    (id) => systems.find((s) => s.id === id)?.label ?? `#${id}`,
  );
  return names.join(", ");
}

/** A short version for a table cell: two names, then "+n". */
export function systemsSummary(u: AdminUser, systems: AdminSystem[]): string {
  const ids = allowedSystemIds(u);
  if (ids.length === 0) return "All";
  const names = ids.map(
    (id) => systems.find((s) => s.id === id)?.label ?? `#${id}`,
  );
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/** Matches the search box against the name, role and systems. */
export function matchesSearch(
  u: AdminUser,
  query: string,
  systems: AdminSystem[],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${u.username} ${u.role} ${systemsLabel(u, systems)} ${u.lastSeenIp ?? ""}`
    .toLowerCase()
    .includes(q);
}

const PASSWORD_ALPHABET =
  "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A readable temporary password with no look-alike characters. */
export function generatePassword(length = 14): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}
