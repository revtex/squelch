import { describe, it, expect } from "vitest";
import { STUCK_QUEUED_AFTER_SEC, isRetryableJob } from "./transcription";
import type { TranscriptionJob } from "@/types";

const now = 1_700_000_000;

function job(partial: Partial<TranscriptionJob>): TranscriptionJob {
  return {
    callId: 1,
    status: "done",
    error: "",
    model: "ggml-base.en",
    durationMs: 0,
    createdAt: now,
    finishedAt: null,
    callTime: now,
    callDurationMs: 1000,
    systemLabel: "Lake",
    talkgroupNumber: 1,
    talkgroupLabel: "Disp",
    ...partial,
  };
}

describe("isRetryableJob", () => {
  it("retries failed and skipped always", () => {
    expect(isRetryableJob(job({ status: "failed" }), now)).toBe(true);
    expect(isRetryableJob(job({ status: "skipped" }), now)).toBe(true);
    expect(isRetryableJob(job({ status: "done" }), now)).toBe(false);
  });

  it("retries queued only after it has sat long enough", () => {
    expect(isRetryableJob(job({ status: "queued", createdAt: now - 30 }), now)).toBe(false);
    expect(isRetryableJob(job({ status: "queued", createdAt: now - STUCK_QUEUED_AFTER_SEC + 1 }), now)).toBe(false);
    expect(isRetryableJob(job({ status: "queued", createdAt: now - STUCK_QUEUED_AFTER_SEC }), now)).toBe(true);
    expect(isRetryableJob(job({ status: "queued", createdAt: now - STUCK_QUEUED_AFTER_SEC - 60 }), now)).toBe(true);
  });
});
