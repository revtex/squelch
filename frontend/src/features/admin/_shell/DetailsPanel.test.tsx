import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailsPanel, FactList } from "./DetailsPanel";
import { InlineConfirm } from "./InlineConfirm";
import { ActionButton } from "./ActionButton";

describe("DetailsPanel", () => {
  it("is a named dialog with focus inside, closing on Escape and on the button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DetailsPanel title="alice" subtitle="Listener" onClose={onClose}>
        <FactList facts={[{ label: "Role", value: "listener" }]} />
      </DetailsPanel>,
    );
    const dialog = screen.getByRole("dialog", { name: "alice" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    expect(screen.getByText("Listener")).toBeInTheDocument();
    expect(screen.getByText("listener")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("InlineConfirm", () => {
  it("confirms or cancels, and waits for a typed confirmation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <InlineConfirm
        title="Delete alice?"
        text="Their bookmarks go too."
        button="Delete"
        danger
        ready={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("group", { name: "Confirm" })).toHaveTextContent(
      "Delete alice?",
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    rerender(
      <InlineConfirm
        title="Delete alice?"
        text="Their bookmarks go too."
        button="Delete"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("ActionButton", () => {
  it("names the action and describes it with the hint", () => {
    render(
      <ActionButton
        icon={<span />}
        label="Sign out everywhere"
        hint="Every device needs the password again."
        onClick={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: "Sign out everywhere" });
    expect(button).toHaveAccessibleDescription(
      "Every device needs the password again.",
    );
  });
});
