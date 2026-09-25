export { default } from "./DashboardsPanel";
export { default as ActivityPanel } from "./activity/ActivityPanel";

// Public re-exports for the trmqtt sub-module — the dashboards barrel
// is the legal entry point per the Bulletproof feature-boundary rules.
export {
  TrMqttPanel,
  trMqttReducer,
  applyTrEvent,
  setSnapshot,
  forgetInstance,
  type TrMqttState,
} from "./trmqtt";
export type { TrEventEnvelope } from "./trmqtt";
