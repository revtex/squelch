import { Field } from "@/features/admin/_shell";
import type { AdminGroup, AdminTag } from "@/types";
import { LED_COLORS, type TalkgroupFormState } from "./systems";

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
        <Field htmlFor={`${id}-led`} label="LED colour">
          <select id={`${id}-led`} className="select w-full" value={form.led} onChange={(e) => onChange("led", e.target.value)}>
            <option value="">System default</option>
            {LED_COLORS.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
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
    </>
  );
}
