import { CHIP, CHIP_OFF, CHIP_ON, Field } from "@/features/admin/_shell";
import type { AdminGroup, AdminTag } from "@/types";
import { LED_COLORS, ledCss, type TalkgroupFormState } from "./systems";

export interface TalkgroupFieldsProps {
  id: string;
  form: TalkgroupFormState;
  groups: AdminGroup[];
  tags: AdminTag[];
  numberEditable: boolean;
  onChange: <K extends keyof TalkgroupFormState>(key: K, value: TalkgroupFormState[K]) => void;
}

/** The talkgroup fields as inputs; used for creating and for editing in place. */
export default function TalkgroupFields({ id, form, groups, tags, numberEditable, onChange }: TalkgroupFieldsProps) {
  return (
    <>
      {numberEditable && (
        <Field htmlFor={`${id}-tg`} label="Talkgroup number" hint="The decimal ID your recorder sends.">
          <input
            id={`${id}-tg`}
            type="number"
            min={0}
            inputMode="numeric"
            className="input w-full"
            value={form.talkgroupId}
            required
            onChange={(e) => onChange("talkgroupId", e.target.value)}
          />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
      <Field htmlFor={`${id}-label`} label="Label" hint="Short, for the scanner display.">
        <input
          id={`${id}-label`}
          type="text"
          className="input w-full"
          maxLength={64}
          value={form.label}
          onChange={(e) => onChange("label", e.target.value)}
        />
      </Field>
      <Field htmlFor={`${id}-name`} label="Name" hint="The full description.">
        <input
          id={`${id}-name`}
          type="text"
          className="input w-full"
          value={form.name}
          onChange={(e) => onChange("name", e.target.value)}
        />
      </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor={`${id}-group`} label="Group">
          <select id={`${id}-group`} className="select w-full" value={form.groupId} onChange={(e) => onChange("groupId", e.target.value)}>
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor={`${id}-tag`} label="Tag">
          <select id={`${id}-tag`} className="select w-full" value={form.tagId} onChange={(e) => onChange("tagId", e.target.value)}>
            <option value="">None</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor={`${id}-freq`} label="Frequency (MHz)" hint="Optional; shown on the display.">
          <input
            id={`${id}-freq`}
            type="number"
            min={0}
            step="0.000001"
            inputMode="decimal"
            className="input w-full"
            value={form.frequency}
            onChange={(e) => onChange("frequency", e.target.value)}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-medium">LED colour</legend>
        <div className="flex flex-wrap gap-1.5">
          {["", ...LED_COLORS].map((c) => {
            const on = form.led === c;
            return (
              <label key={c || "default"} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} has-[:focus-visible]:outline-2`}>
                <input
                  type="radio"
                  name={`${id}-led`}
                  className="sr-only"
                  value={c}
                  checked={on}
                  onChange={() => onChange("led", c)}
                />
                {c && (
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ledCss(c) }} aria-hidden="true" />
                )}
                {c ? c.charAt(0).toUpperCase() + c.slice(1) : "System default"}
              </label>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}
