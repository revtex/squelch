import { playBeep } from "@/shared/services/audio/beep";
import { BEEP_STYLES } from "../hooks/useKeypadBeeps";

interface KeypadBeepsPickerProps {
  isOpen: boolean;
  selected: string;
  onSelect: (style: string) => void;
  onClose: () => void;
}

/**
 * The per-browser keypad beep. Picking a style plays it: a sound is not
 * something anyone can choose off a list of names, and picking the one
 * already selected plays it again rather than doing nothing, because the
 * reason to click a sound you have chosen is to hear it once more.
 */
export function KeypadBeepsPicker({
  isOpen,
  selected,
  onSelect,
  onClose,
}: KeypadBeepsPickerProps) {
  if (!isOpen) return null;

  return (
    <dialog open className="modal modal-open" onClick={onClose}>
      <div className="modal-box max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg">Keypad beeps</h3>
        <p className="mt-1 mb-4 text-xs text-base-content-dim">
          Kept in this browser, not on the server.
        </p>
        <fieldset className="space-y-1" aria-label="Keypad beeps">
          {BEEP_STYLES.map((style) => (
            <label
              key={style.id}
              className="flex items-center gap-3 rounded-box px-2 py-2 cursor-pointer hover:bg-base-200"
            >
              <input
                type="radio"
                name="keypad-beeps"
                className="radio radio-sm"
                checked={selected === style.id}
                onChange={() => {
                  onSelect(style.id);
                  playBeep(style.id);
                }}
                // A radio already checked fires no change, so the click is
                // what plays it again.
                onClick={() => {
                  if (selected === style.id) playBeep(style.id);
                }}
              />
              <span className="flex-1 min-w-0 font-semibold">
                {style.label}
              </span>
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
