// Internal barrel for the admin chrome (slice, hooks, providers, and the
// primitives every admin page is built from). Sub-features under
// features/admin/<x>/ import from here. The leading underscore marks this as
// not-a-feature-itself; sibling sub-features may import _shell/, but _shell/
// may not import sibling sub-features.
export * from "./adminSlice";
export * from "./useAdminWebSocket";
export * from "./useAdminWsOps";
export * from "./useNavigationGuard";
export * from "./useWsQuery";
export * from "./useAdminWsStatus";
export * from "./useDetails";
export * from "./useToast";
export * from "./DetailsPanel";
export * from "./InlineConfirm";
export * from "./ActionButton";
export * from "./OpenButton";
export * from "./DataTable";
export * from "./FilterChips";
export * from "./SearchBox";
export * from "./PageHeader";
export * from "./Field";
export * from "./nav";
export * from "./CommandPalette";
export * from "./format";
