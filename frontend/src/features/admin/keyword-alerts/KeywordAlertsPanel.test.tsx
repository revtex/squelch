import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import KeywordAlertsPanel from "./KeywordAlertsPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { AdminKeywordRule, AdminKeywordTarget } from "@/types";

const rules: AdminKeywordRule[] = [
  {
    id: 1,
    label: "413",
    patternsJson: '["413","four thirteen"]',
    systemsJson: null,
    talkgroupsJson: null,
    cooldownSec: 120,
    disabled: 0,
    order: 0,
    createdAt: 1_700_000_000,
  },
];

const targets: AdminKeywordTarget[] = [
  {
    id: 2,
    label: "Slack",
    type: "slack",
    url: "https://hooks.slack.com/example",
    hasSecret: false,
    rulesJson: null,
    disabled: 0,
    order: 0,
    last: null,
    lastOkAt: null,
    sent24h: 0,
    failed24h: 0,
  },
];

const dryRun = vi.fn();

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useListKeywordRulesQuery: () => ({ data: rules, isLoading: false, refetch: vi.fn() }),
  useListKeywordTargetsQuery: () => ({ data: targets, isLoading: false, refetch: vi.fn() }),
  useListSystemsQuery: () => ({ data: [] }),
  useListTalkgroupsQuery: () => ({ data: [] }),
  useCreateKeywordRuleMutation: () => [vi.fn(), {}],
  useUpdateKeywordRuleMutation: () => [vi.fn(), {}],
  useDeleteKeywordRuleMutation: () => [vi.fn(), {}],
  useCreateKeywordTargetMutation: () => [vi.fn(), {}],
  useUpdateKeywordTargetMutation: () => [vi.fn(), {}],
  useDeleteKeywordTargetMutation: () => [vi.fn(), {}],
  useTestKeywordTargetMutation: () => [vi.fn(), {}],
  useKeywordAlertDryRunMutation: () => [
    (arg: unknown) => ({ unwrap: () => dryRun(arg) }),
    {},
  ],
}));

describe("KeywordAlertsPanel", () => {
  beforeEach(() => {
    dryRun.mockReset().mockResolvedValue({ matched: ["413"] });
  });

  it("lists rules and runs a dry match", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ToastProvider>
          <KeywordAlertsPanel />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Keyword alerts" })).toBeInTheDocument();
    expect(screen.getByText("413")).toBeInTheDocument();
    expect(screen.getByText("2 patterns")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Match" }));
    expect(dryRun).toHaveBeenCalled();
    expect(await screen.findByText("Matched: 413")).toBeInTheDocument();
  });

  it("switches to the Targets tab", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ToastProvider>
          <KeywordAlertsPanel />
        </ToastProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("radio", { name: /Targets/ }));
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test" })).toBeInTheDocument();
  });
});
