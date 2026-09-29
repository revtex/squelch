import { useCallback, useState } from "react";
import { Share2, Copy, ExternalLink, X } from "lucide-react";
import { useShareCallMutation } from "../shareSlice";

interface ShareCallButtonProps {
  callId: number;
  /** Extra classes applied to the trigger button. Defaults to small ghost square. */
  className?: string;
  /** Icon size in pixels (square). Defaults to 12 (w-3 h-3). */
  iconSize?: number;
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path below
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Small icon button that creates a shareable link for a call and shows a
 * modal with the resulting URL (copy / open actions). Intended for use in
 * list rows (search results, bookmarks) next to play/download/bookmark.
 */
export function ShareCallButton({
  callId,
  className = "btn btn-ghost btn-xs btn-square",
  iconSize = 12,
}: ShareCallButtonProps) {
  const [shareCall] = useShareCallMutation();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const result = await shareCall(callId).unwrap();
        setShareUrl(`${window.location.origin}${result.url}`);
      } catch {
        showToast("Failed to share call");
      }
    },
    [callId, shareCall, showToast],
  );

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    const copied = await copyToClipboard(shareUrl);
    showToast(
      copied
        ? "Link copied to clipboard"
        : "Copy failed - long-press URL to copy",
    );
  }, [shareUrl, showToast]);

  return (
    <>
      <span
        className="tooltip tooltip-top tooltip-flush-right"
        data-tip="Share call"
      >
        <button
          onClick={handleClick}
          className={className}
          aria-label="Share call"
        >
          <Share2 style={{ width: iconSize, height: iconSize }} />
        </button>
      </span>

      {shareUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-xl rounded-lg border border-base-300 bg-base-100 p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/70">
                Share Link
              </h3>
              <button
                className="btn btn-ghost btn-xs btn-circle"
                onClick={() => setShareUrl(null)}
                aria-label="Close share popup"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="input input-sm w-full"
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Share URL"
              />
              <span className="tooltip tooltip-top" data-tip="Copy">
                <button
                  className="btn btn-primary btn-sm btn-square"
                  onClick={handleCopy}
                  aria-label="Copy share URL"
                >
                  <Copy size={16} />
                </button>
              </span>
              <span className="tooltip tooltip-top" data-tip="Open">
                <button
                  className="btn btn-ghost btn-sm btn-square"
                  onClick={() => {
                    window.open(shareUrl, "_blank", "noopener,noreferrer");
                  }}
                  aria-label="Open share URL"
                >
                  <ExternalLink size={16} />
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast toast-end toast-bottom z-50">
          <div className="alert alert-info">
            <span>{toast}</span>
          </div>
        </div>
      )}
    </>
  );
}
