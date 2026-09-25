import { useEffect, useState } from "react";
import { useNavigationGuard } from "@/features/admin/_shell";
import type { AdminApiKey } from "@/types";
import { allowedSystemIds } from "./keys";

export interface ApiKeyFormValues {
  ident: string;
  disabled: number;
  systemsJson: string | null;
  callRateLimit: number | null;
}

interface FormState {
  ident: string;
  enabled: boolean;
  systems: number[];
  rate: string;
}

function fromKey(k: AdminApiKey | null): FormState {
  return {
    ident: k?.ident ?? "",
    enabled: k ? k.disabled === 0 : true,
    systems: k ? allowedSystemIds(k) : [],
    rate: k?.callRateLimit != null ? String(k.callRateLimit) : "",
  };
}

/**
 * A key's editable fields, with a navigation guard while they have unsaved
 * changes. Shared by the create panel and the details panel.
 */
export function useKeyForm(apiKey: AdminApiKey | null) {
  const [form, setForm] = useState<FormState>(() => fromKey(apiKey));
  const [dirty, setDirty] = useState(false);
  const { setGuard } = useNavigationGuard();

  useEffect(() => {
    setGuard(dirty ? () => true : null);
    return () => setGuard(null);
  }, [dirty, setGuard]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  /** The values to send. */
  const values = (): ApiKeyFormValues => {
    return {
      ident: form.ident.trim(),
      disabled: form.enabled ? 0 : 1,
      systemsJson: form.systems.length === 0 ? null : JSON.stringify(form.systems),
      callRateLimit: form.rate ? Number(form.rate) : null,
    };
  };

  /** Call once the server has the values: clears the unsaved-changes guard. */
  const markSaved = () => setDirty(false);

  return { form, set, dirty, values, markSaved };
}

export type KeyForm = ReturnType<typeof useKeyForm>;
