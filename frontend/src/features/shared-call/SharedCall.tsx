import { useParams } from "react-router-dom";
import { useGetSharedCallQuery } from "@/features/scanner";
import { Download, Radio, Smartphone } from "lucide-react";
import { buildAppHandoff } from "./appHandoff";

function formatDuration(secs: number): string {
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatFrequency(hz: number): string {
  if (hz === 0) return "";
  return `${(hz / 1_000_000).toFixed(4)} MHz`;
}

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

function getSafeSharedAudioUrl(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;

  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    if (!parsed.pathname.startsWith("/api/shared/")) return null;
    if (!parsed.pathname.endsWith("/audio")) return null;
    if (parsed.pathname.includes("\\")) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export default function SharedCall() {
  const { token } = useParams<{ token: string }>();
  const {
    data: call,
    isLoading,
    isError,
  } = useGetSharedCallQuery(token ?? "", {
    skip: !token,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (isError || !call) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="card bg-base-200 shadow-xl max-w-md w-full mx-4">
          <div className="card-body items-center text-center">
            <Radio className="w-12 h-12 text-base-content/40" />
            <h2 className="card-title">Call not found</h2>
            <p className="text-base-content/60">
              This call may have been removed or sharing may be disabled.
            </p>
            <div className="card-actions mt-4">
              <a href="/" className="btn btn-primary">
                Go to Scanner
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Offered only to a phone, and only for a well-formed token: on a desktop
  // browser a custom-scheme link is a dead end. Read from window here so the
  // builder itself stays pure and testable.
  const handoff = buildAppHandoff({
    token,
    pageUrl: window.location.href,
    origin: window.location.origin,
    userAgent: navigator.userAgent,
  });

  const safeAudioUrl = getSafeSharedAudioUrl(call.audioUrl);
  if (!safeAudioUrl) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="card bg-base-200 shadow-xl max-w-md w-full mx-4">
          <div className="card-body items-center text-center">
            <Radio className="w-12 h-12 text-base-content/40" />
            <h2 className="card-title">Call not found</h2>
            <p className="text-base-content/60">
              This call may have been removed or sharing may be disabled.
            </p>
            <div className="card-actions mt-4">
              <a href="/" className="btn btn-primary">
                Go to Scanner
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="card bg-base-200 shadow-xl max-w-lg w-full">
        <div className="card-body gap-4">
          <h2 className="card-title text-primary">
            <Radio className="w-5 h-5" />
            Shared Call
          </h2>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-base-content/60">System</div>
            <div className="font-medium">{call.systemLabel}</div>

            <div className="text-base-content/60">Talkgroup</div>
            <div className="font-medium">
              {call.talkgroupLabel}
              {call.talkgroupName && (
                <span className="text-base-content/60 ml-1">
                  ({call.talkgroupName})
                </span>
              )}
            </div>

            <div className="text-base-content/60">Date / Time</div>
            <div className="font-medium">{formatDate(call.dateTime)}</div>

            {call.duration > 0 && (
              <>
                <div className="text-base-content/60">Duration</div>
                <div className="font-medium">
                  {formatDuration(call.duration)}
                </div>
              </>
            )}

            {call.frequency > 0 && (
              <>
                <div className="text-base-content/60">Frequency</div>
                <div className="font-medium">
                  {formatFrequency(call.frequency)}
                </div>
              </>
            )}

            {call.source > 0 && (
              <>
                <div className="text-base-content/60">Source</div>
                <div className="font-medium">{call.source}</div>
              </>
            )}
          </div>

          {/* Audio player */}
          <audio
            controls
            src={safeAudioUrl}
            className="w-full"
            preload="metadata"
          />

          {/* Transcript */}
          {call.transcript && (
            <div className="bg-base-300 rounded-lg p-3">
              <div className="text-xs font-semibold text-base-content/60 mb-1 uppercase">
                Transcript
              </div>
              <p className="text-sm whitespace-pre-wrap">{call.transcript}</p>
            </div>
          )}

          {/* Open in app / Download */}
          <div className="card-actions justify-end">
            {handoff && (
              <a href={handoff.href} className="btn btn-sm btn-outline">
                <Smartphone className="w-4 h-4" />
                Open in app
              </a>
            )}
            <a href={safeAudioUrl} download className="btn btn-sm btn-outline">
              <Download className="w-4 h-4" />
              Download
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
