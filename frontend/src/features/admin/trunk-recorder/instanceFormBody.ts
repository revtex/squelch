// Body builders for InstanceForm — kept in a separate module so the
// component file can satisfy the react-refresh "only-export-components" rule.
import type { InstanceFormValues } from "./InstanceForm";

/** Shape the form values into the REST POST body for create. */
export function valuesToCreateBody(v: InstanceFormValues) {
  return {
    label: v.label,
    instanceId: v.instanceId,
    brokerUrl: v.brokerUrl,
    baseTopic: v.baseTopic,
    unitTopic: v.unitTopic || undefined,
    messageTopic: v.messageTopic || undefined,
    username: v.username || undefined,
    password: v.passwordMode === "set" ? v.password : undefined,
    tlsSkipVerify: v.tlsSkipVerify,
    qos: v.qos,
    enabled: v.enabled,
  };
}

/** Shape the form values into the REST PATCH body honoring tri-state password. */
export function valuesToUpdateBody(v: InstanceFormValues) {
  let password: string | undefined;
  if (v.passwordMode === "clear") password = "";
  else if (v.passwordMode === "set") password = v.password;
  return {
    label: v.label,
    instanceId: v.instanceId,
    brokerUrl: v.brokerUrl,
    baseTopic: v.baseTopic,
    unitTopic: v.unitTopic || undefined,
    messageTopic: v.messageTopic || undefined,
    username: v.username || undefined,
    password,
    tlsSkipVerify: v.tlsSkipVerify,
    qos: v.qos,
    enabled: v.enabled,
  };
}
