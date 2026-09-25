// Admin DTOs (mirrors of ADM/ADMRES payloads and admin REST envelopes).

export interface AdminUser {
  id: number;
  username: string;
  role: "admin" | "listener";
  disabled: number; // 0 or 1
  systemsJson: string | null;
  expiration: number | null; // unix timestamp
  limit: number | null; // concurrent connection limit
  createdAt: number;
  updatedAt: number;
  /** 1 when the user has a temporary password and must pick their own. */
  passwordNeedChange: number;
  /** Open LIVE, BKGND and admin connections right now. */
  liveConnections: number;
  /** Browsers and phones that can still sign back in without a password. */
  devices: number;
  /** When and from where the account last renewed its sign-in. */
  lastSeenAt: number | null;
  lastSeenIp: string | null;
}

/** An address the sign-in limiter is counting failures for or keeping out. */
export interface AdminLockout {
  ip: string;
  failures: number;
  /** Unix seconds; null while the address still has attempts left. */
  lockedUntil: number | null;
  lastFailure: number;
}

export interface AdminLockoutsList {
  lockouts: AdminLockout[];
}

export interface AdminSystem {
  id: number;
  systemId: number;
  label: string;
  autoPopulateTalkgroups: number;
  blacklistsJson: string | null;
  led: string | null;
  order: number;
}

export interface AdminTalkgroup {
  id: number;
  systemId: number;
  talkgroupId: number;
  label: string | null;
  name: string | null;
  frequency: number | null;
  led: string | null;
  groupId: number | null;
  tagId: number | null;
  order: number;
}

export interface AdminUnit {
  id: number;
  systemId: number;
  unitId: number;
  label: string | null;
  order: number;
}

export interface AdminGroup {
  id: number;
  label: string;
  /** How many talkgroups are in this group. */
  talkgroups: number;
}

export interface AdminTag {
  id: number;
  label: string;
  /** How many talkgroups carry this tag. */
  talkgroups: number;
}

/**
 * Deleting a group or tag that talkgroups still use needs a destination:
 * another id, or null to leave them without one.
 */
export interface DeleteLabelPayload {
  id: number;
  reassign?: boolean;
  moveTo?: number | null;
}

export interface DeleteLabelResult {
  ok: boolean;
  /** Talkgroups moved before the delete. */
  moved: number;
}

export interface AdminApiKey {
  id: number;
  fingerprint: string;
  ident: string | null;
  disabled: number;
  systemsJson: string | null;
  callRateLimit: number | null;
  order: number;
  createdAt: number;
  /** Unix seconds of the last authenticated request, or null if never. */
  lastUsedAt: number | null;
  lastUsedIp: string | null;
  /** Calls uploaded with this key in the last 24 hours. */
  calls24h: number;
  /** Requests on the deprecated /api/* surface in the last 24 hours. */
  legacy24h: number;
  /** While set, the secret this key had before its last rotation still works until then. */
  previousKeyExpiresAt: number | null;
}

export interface AdminApiKeyCreateResponse extends AdminApiKey {
  createdKey: string;
}

/** How one delivery went: a call forwarded, or a test. */
export interface DeliveryResult {
  at: number;
  ok: boolean;
  status: number;
  error: string;
  millis: number;
}

/** What downstreams and webhooks share: an address and how sending goes. */
export interface ForwardingTarget {
  id: number;
  label: string;
  url: string;
  systemsJson: string | null;
  disabled: number;
  order: number;
  last: DeliveryResult | null;
  lastOkAt: number | null;
  sent24h: number;
  failed24h: number;
}

export interface AdminDownstream extends ForwardingTarget {
  hasApiKey: boolean;
}

export interface AdminDownstreamCreate {
  label: string;
  url: string;
  apiKey: string;
  systemsJson: string | null;
  disabled: number;
  order: number;
}

export interface AdminDownstreamUpdate extends AdminDownstreamCreate {
  id: number;
}

export type WebhookType = "generic" | "discord";

export interface AdminWebhook extends ForwardingTarget {
  type: WebhookType;
  /** The secret itself never reaches the browser. */
  hasSecret: boolean;
}

export interface AdminWebhookCreate {
  label: string;
  url: string;
  type: WebhookType;
  /** Blank keeps the current secret when editing. */
  secret?: string;
  clearSecret?: boolean;
  systemsJson: string | null;
  disabled: number;
  order: number;
}

export interface AdminWebhookUpdate extends AdminWebhookCreate {
  id: number;
}

/** The payload and headers a generic webhook receives, for the preview. */
export interface WebhookSample {
  payload: unknown;
  headers: Record<string, string>;
}

export interface AdminSetting {
  key: string;
  value: string;
}

export interface Capabilities {
  ffmpeg: boolean;
  fdkAac: boolean;
  whisper: boolean;
}

export interface ConfigResponse {
  settings: AdminSetting[];
  capabilities: Capabilities;
}

export interface AdminLog {
  dateTime: number;
  level: string;
  message: string;
  attrs?: Record<string, string>;
}

// User create/update payload
export interface CreateUserPayload {
  username: string;
  password: string;
  role: "admin" | "listener";
  disabled?: number;
  systemsJson?: string | null;
  expiration?: number | null;
  limit?: number | null;
  /** Default 1: the user picks their own password at first sign-in. */
  passwordNeedChange?: number;
}

export interface UpdateUserPayload {
  username?: string;
  /** Resets the password; an admin reset asks for a change next time. */
  password?: string;
  role?: "admin" | "listener";
  disabled?: number;
  systemsJson?: string | null;
  expiration?: number | null;
  limit?: number | null;
  passwordNeedChange?: number;
  /** Also sign the account out on every device. */
  signOut?: boolean;
}

export interface AdminDirMonitor {
  id: number;
  directory: string;
  type: string;
  mask: string | null;
  extension: string | null;
  frequency: number | null;
  delay: number | null;
  deleteAfter: number;
  usePolling: number;
  disabled: number;
  systemId: number | null;
  talkgroupId: number | null;
  order: number;
}

// --- RadioReference enrichment types ---

export interface RRTalkgroupCandidate {
  row: number;
  talkgroupId: number;
  label?: string;
  name?: string;
  group?: string;
  tag?: string;
  led?: string;
  order?: number;
}

export interface RRPreviewRow extends RRTalkgroupCandidate {
  matched: boolean;
  wouldUpdate: boolean;
  wouldUpdateFields: string[];
  skipReason?: string;
}

export interface RRRowError {
  row: number;
  reason: string;
}

export interface RRPreviewResponse {
  processed: number;
  matched: number;
  wouldUpdate: number;
  skipped: number;
  errors: number;
  rowErrors: RRRowError[];
  rows: RRPreviewRow[];
}

export interface RRApplyRequest {
  systemId: number;
  candidates: RRTalkgroupCandidate[];
  mergeMode: string;
  selectedFields: string[];
}

export interface RRApplyResponse {
  processed: number;
  matched: number;
  updated: number;
  skipped: number;
  errors: number;
  rowErrors: RRRowError[];
}

// --- Shared Links (admin) ---

export interface SharedLinkAdmin {
  id: number;
  callId: number;
  userId: number;
  token: string;
  createdAt: number;
  sharedBy: string;
  dateTime: number;
  duration: number;
  systemLabel: string;
  talkgroupLabel: string;
  talkgroupName: string;
  /** The link's own expiry, if it has one. */
  expiresAt: number | null;
  /** When the link stops working, its own expiry or the server-wide one; null means never. */
  effectiveExpiresAt: number | null;
  expired: boolean;
  /** Times the public page fetched the call. */
  opens: number;
  lastOpenedAt: number | null;
}

/** Enough to put a revoked link back with the same URL. */
export interface RestoreSharedLinkPayload {
  callId: number;
  userId: number;
  token: string;
  createdAt: number;
  expiresAt: number | null;
}

// --- Connections (admin) ---

/** listener = a LIVE socket, admin = the admin dashboard, stream = BKGND audio. */
export type ConnectionKind = "listener" | "admin" | "stream";

/** Whether countries are shown, and the credit the database asks for. */
export interface GeoIPInfo {
  enabled: boolean;
  credit: { text: string; url: string } | null;
}

/** Where an address is: a country, the local network, or unknown. */
export interface AddressPlace {
  /** ISO 3166-1 alpha-2 code; null when unknown or local. */
  country: string | null;
  /** A private, loopback or link-local address. */
  local: boolean;
}

export interface AdminConnection extends AddressPlace {
  id: string;
  kind: ConnectionKind;
  /** null for an anonymous (public access) listener. */
  userId: number | null;
  username: string;
  role: string;
  familyId: string | null;
  ip: string | null;
  userAgent: string;
  native: boolean;
  protocol: string;
  connectedAt: number;
  /** The admin connection this list was requested over. */
  self: boolean;
  /** On the server's trusted list: can never be blocked. */
  trusted: boolean;
}

export interface AdminConnectionsList {
  connections: AdminConnection[];
  geoip: GeoIPInfo;
}

/** A signed-in device: one refresh-token family, as it was last used. */
export interface AdminSession extends AddressPlace {
  familyId: string;
  userId: number;
  username: string;
  role: string;
  ip: string | null;
  userAgent: string | null;
  native: boolean;
  signedInAt: number | null;
  lastUsedAt: number;
  expiresAt: number;
  liveConnections: number;
  /** The device this list was requested from. */
  current: boolean;
  /** Its last address is on the server's trusted list. */
  trusted: boolean;
}

export interface AdminSessionsList {
  sessions: AdminSession[];
  geoip: GeoIPInfo;
}

export interface AdminConnectionHistoryEntry extends AddressPlace {
  id: number;
  kind: ConnectionKind;
  userId: number | null;
  username: string | null;
  ip: string;
  userAgent: string | null;
  native: boolean;
  familyId: string | null;
  connectedAt: number;
  disconnectedAt: number | null;
  disconnectReason: string | null;
  /** On the server's trusted list: can never be blocked. */
  trusted: boolean;
}

export interface AdminConnectionHistoryPage {
  items: AdminConnectionHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  /** 0 means history is turned off. */
  retentionDays: number;
  geoip: GeoIPInfo;
}

export type ConnectionHistoryFilter = {
  ip?: string;
  userId?: number;
  kind?: ConnectionKind;
  since?: number;
  until?: number;
  page?: number;
  pageSize?: number;
};

// --- Server filesystem types ---

export interface ServerDirectoryEntry {
  name: string;
  path: string;
}

export interface ServerDirectoryListResponse {
  path: string;
  parent: string | null;
  directories: ServerDirectoryEntry[];
}

// --- Transcription types ---

export interface TranscriptionStatus {
  enabled: boolean;
  url: string;
  model: string;
  language: string;
  diarize: boolean;
  liveDisplay: boolean;
  connected: boolean;
}

export interface WhisperModel {
  id: string;
  object: string;
  path: string;
  created: number;
  owned_by: string;
}

export interface TranscriptionModelsResponse {
  object: string;
  models: WhisperModel[];
}

export interface TranscriptionStats {
  total: number;
  recent24h: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  queueDepth: number;
  poolEnabled: boolean;
  byLanguage: { language: string; count: number }[];
  byModel: { model: string; count: number }[];
}

/** A blocked address or range. */
export interface AdminIPBlock {
  id: number;
  cidr: string;
  reason: string;
  /** Username of the admin who added it; null if that account is gone. */
  createdBy: string | null;
  createdAt: number;
  /** Unix seconds; null = until removed. */
  expiresAt: number | null;
}

export interface AdminIPBlocksList {
  /** False when the server runs without address blocking. */
  enabled: boolean;
  blocks: AdminIPBlock[];
  /** Addresses that can never be blocked: loopback plus the server's list. */
  trusted: string[];
  /** The address the admin is connected from, as the server sees it. */
  yourAddress: string | null;
}

export interface CreateIPBlockPayload {
  address: string;
  reason: string;
  expiresAt?: number;
  force?: boolean;
}

/**
 * Either the block was made, or it would include the admin's own address
 * and needs confirming (resend with force).
 */
export type CreateIPBlockResult =
  | { ok: true; id: number; cidr: string; closed: number }
  | { needsConfirm: true; cidr: string; message: string };
