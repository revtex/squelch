import { useTheme } from "@/shared/hooks/useTheme";

interface ThemePickerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The per-browser theme choice. Each row previews its theme with a strip
 * of five swatches — page, panel, display block, text, secondary — drawn
 * inside that theme's own data-theme scope, so the swatches are the real
 * tokens rather than a second copy of the palette.
 */
export function ThemePicker({ isOpen, onClose }: ThemePickerProps) {
  const { theme, setTheme, themes } = useTheme();
  if (!isOpen) return null;

  return (
    <dialog open className="modal modal-open" onClick={onClose}>
      <div className="modal-box max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg mb-4">Theme</h3>
        <fieldset className="space-y-1" aria-label="Theme">
          {themes.map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-3 rounded-box px-2 py-2 cursor-pointer hover:bg-base-200"
            >
              <span
                data-theme={t.id}
                aria-hidden="true"
                className="flex shrink-0 overflow-hidden rounded border border-base-300"
              >
                <span className="w-4 h-8 bg-base-100" />
                <span className="w-4 h-8 bg-base-200" />
                <span className="w-4 h-8 bg-lcd-face" />
                <span className="w-4 h-8 bg-base-content" />
                <span className="w-4 h-8 bg-secondary" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold">{t.label}</span>
                <span className="block text-xs text-base-content-dim">
                  {t.summary}
                </span>
              </span>
              <input
                type="radio"
                name="theme"
                className="radio radio-sm"
                checked={theme === t.id}
                onChange={() => setTheme(t.id)}
              />
            </label>
          ))}
        </fieldset>
        <div className="modal-action">
          <button className="btn btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
