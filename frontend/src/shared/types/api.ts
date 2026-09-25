// REST request/response envelopes (non-admin).

// Setup status from GET /api/v1/setup/status
export interface SetupStatus {
  needsSetup: boolean;
  publicAccess: boolean;
}

// Legacy /api/* usage report from GET /api/v1/admin/legacy-usage
export interface LegacyUsageEntry {
  path: string;
  method: string;
  apiKeyIdent: string;
  /** The key that made the requests; absent when none did. */
  apiKeyId?: number;
  count: number;
  lastSeen: string;
}

export interface LegacyUsageResponse {
  windowSeconds: number;
  generatedAt: string;
  entries: LegacyUsageEntry[];
}
