import { DetailsPanel, formatDateTime } from "@/features/admin/_shell";
import type { AdminApiKey, AdminSystem } from "@/types";
import CopyField from "./CopyField";
import { allowedSystemIds, keyName, testCommand, trunkRecorderSnippet } from "./keys";

export interface NewSecretPanelProps {
  apiKey: AdminApiKey;
  secret: string;
  /** Set after a rotation: when the old secret stops working. */
  previousUntil: number | null;
  systems: AdminSystem[];
  onClose: () => void;
}

/**
 * The one time a secret is shown: right after a key is created or rotated.
 * Comes with a test command and a Trunk-Recorder snippet so it can be put
 * to use before the panel closes.
 */
export default function NewSecretPanel({
  apiKey,
  secret,
  previousUntil,
  systems,
  onClose,
}: NewSecretPanelProps) {
  const origin = window.location.origin;
  return (
    <DetailsPanel
      title={previousUntil ? `New secret for ${keyName(apiKey)}` : `${keyName(apiKey)} created`}
      subtitle="Copy it now. It's not shown again."
      size="wide"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {previousUntil && (
        <div className="alert alert-warning">
          The old secret keeps working until {formatDateTime(previousUntil)}, so
          you can update the recorder without a gap.
        </div>
      )}
      <CopyField label="Secret" value={secret} />
      <CopyField
        label="Test command"
        value={testCommand(secret, origin)}
        multiline
        hint="Run it on the recorder's machine. A 200 means the key and the address are right."
      />
      <CopyField
        label="Trunk-Recorder plugin entry"
        value={trunkRecorderSnippet(secret, origin, systems, allowedSystemIds(apiKey))}
        multiline
        hint='Add it to the "plugins" list in config.json and set each shortName to match your Trunk-Recorder system.'
      />
    </DetailsPanel>
  );
}
