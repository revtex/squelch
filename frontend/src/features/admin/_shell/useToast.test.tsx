import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./useToast";

function Buttons({ undo }: { undo: () => void }) {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success("Saved.")}>
        save
      </button>
      <button type="button" onClick={() => toast.error("It broke.")}>
        fail
      </button>
      <button
        type="button"
        onClick={() => toast.success("Deleted alice.", { undo })}
      >
        delete
      </button>
    </>
  );
}

describe("useToast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a success message that goes away on its own", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Buttons undo={() => {}} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps an error until it is dismissed", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Buttons undo={() => {}} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fail" }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("It broke.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers an undo and runs it", async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    render(
      <ToastProvider>
        <Buttons undo={undo} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "delete" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is a no-op without a provider", async () => {
    const user = userEvent.setup();
    render(<Buttons undo={() => {}} />);
    await user.click(screen.getByRole("button", { name: "save" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
