import { useState } from "react";
import { DetailsPanel, FilterChips, formatDateTime } from "@/features/admin/_shell";
import type { AdminApiKey, AdminSystem } from "@/types";
import CopyField from "./CopyField";
import {
  allowedSystemIds,
  keyName,
  SQUELCH_PLUGIN_URL,
  testCommand,
  trunkRecorderSnippet,
  type RecorderPlugin,
} from "./keys";

const PLUGINS = [
  { id: "squelch", label: "Squelch uploader" },
  { id: "rdioscanner", label: "Built-in rdio-scanner" },
] as const;

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
  const [plugin, setPlugin] = useState<RecorderPlugin>("squelch");
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
        hint="Run it on the recorder's machine. It prints 204 when the key and the address are right, and 401 when the key is refused."
      />
      <div className="fieldset">
        <span className="fieldset-legend">Trunk-Recorder plugin</span>
        <FilterChips label="Trunk-Recorder plugin" options={PLUGINS} value={plugin} onChange={setPlugin} />
      </div>
      <CopyField
        label="Trunk-Recorder plugin entry"
        value={trunkRecorderSnippet(plugin, secret, origin, systems, allowedSystemIds(apiKey))}
        multiline
        hint={
          plugin === "squelch" ? (
            <>
              Needs the Squelch uploader built into Trunk-Recorder: clone{" "}
              <a className="link" href={SQUELCH_PLUGIN_URL} target="_blank" rel="noreferrer">
                squelch-tr-uploader
              </a>{" "}
              into its <code>user_plugins/</code> folder and rebuild. Add this entry to the &quot;plugins&quot; list in
              config.json and set each shortName to match a Trunk-Recorder system.
            </>
          ) : (
            <>
              Ships with Trunk-Recorder, so there is nothing to build. It posts to the older{" "}
              <code>/api/call-upload</code>, which is deprecated: Overview lists these uploads until the recorder
              moves to the Squelch uploader.
            </>
          )
        }
      />
    </DetailsPanel>
  );
}
