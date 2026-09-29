import { Star } from "lucide-react";

interface BookmarkButtonProps {
  isBookmarked: boolean;
  onToggle: () => void;
}

export function BookmarkButton({
  isBookmarked,
  onToggle,
}: BookmarkButtonProps) {
  return (
    <button
      // On the display these are engraved marks, not chrome: no plate
      // behind them in any theme, just dim until the pointer is on them.
      className={`btn btn-circle btn-ghost btn-xs border-0 bg-transparent hover:bg-transparent transition-opacity ${
        isBookmarked ? "opacity-100" : "opacity-55 hover:opacity-100"
      }`}
      onClick={onToggle}
      aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
    >
      <Star className="w-4 h-4" fill={isBookmarked ? "currentColor" : "none"} />
    </button>
  );
}
