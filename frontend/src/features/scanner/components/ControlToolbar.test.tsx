import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ControlToolbar } from "../components/ControlToolbar";

function defaultProps() {
  return {
    isPaused: false,
    isLive: true,
    volume: 0.8,
    heldSystem: null as number | null,
    heldTG: null as number | null,
    currentCallTgId: undefined as number | undefined,
    currentCallSystemId: undefined as number | undefined,
    onTogglePause: vi.fn(),
    onToggleLive: vi.fn(),
    onSkip: vi.fn(),
    onReplay: vi.fn(),
    onSetVolume: vi.fn(),
    onHoldSystem: vi.fn(),
    onHoldTG: vi.fn(),
    onAddAvoid: vi.fn(),
    onToggleSelectTG: vi.fn(),
    onToggleSearch: vi.fn(),
  };
}

describe("ControlToolbar", () => {
  it("renders Pause button when not paused", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("renders Resume button when paused", () => {
    const props = defaultProps();
    props.isPaused = true;
    render(<ControlToolbar {...props} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("calls onTogglePause when play/pause button clicked", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(props.onTogglePause).toHaveBeenCalledOnce();
  });

  it("calls onSkip when skip button clicked", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(props.onSkip).toHaveBeenCalledOnce();
  });

  it("calls onReplay when replay button clicked", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(props.onReplay).toHaveBeenCalledOnce();
  });

  it("calls onToggleLive when LIVE button clicked", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} />);
    fireEvent.click(screen.getByText("LIVE"));
    expect(props.onToggleLive).toHaveBeenCalledOnce();
  });

  it("LIVE button has success style when isLive is true", () => {
    const props = defaultProps();
    props.isLive = true;
    render(<ControlToolbar {...props} />);
    const liveBtn = screen.getByText("LIVE").closest("button")!;
    expect(liveBtn.className).toContain("btn-success");
  });

  it("LIVE button has the resting style when isLive is false", () => {
    // Resting mode buttons sit on base-300 rather than nothing, so they
    // read as buttons before being pressed; the active state stays bold
    // enough to remain the obvious difference.
    const props = defaultProps();
    props.isLive = false;
    render(<ControlToolbar {...props} />);
    const liveBtn = screen.getByText("LIVE").closest("button")!;
    expect(liveBtn.className).toContain("bg-base-300");
    expect(liveBtn.className).not.toContain("btn-success");
  });

  it("volume slider changes value via onSetVolume", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} />);
    // The desktop range input
    const sliders = document.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBeGreaterThan(0);
    fireEvent.change(sliders[0], { target: { value: "0.5" } });
    expect(props.onSetVolume).toHaveBeenCalledWith(0.5);
  });

  it("calls onSetVolume(0) when mute button clicked and not muted", () => {
    const props = defaultProps();
    props.volume = 0.8;
    render(<ControlToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(props.onSetVolume).toHaveBeenCalledWith(0);
  });

  it("calls onSetVolume(0.8) when unmute button clicked and muted", () => {
    const props = defaultProps();
    props.volume = 0;
    render(<ControlToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(props.onSetVolume).toHaveBeenCalledWith(0.8);
  });

  it('HOLD dropdown shows "Hold System" and "Hold Talkgroup" options', () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} />);
    expect(screen.getByText("Hold System")).toBeInTheDocument();
    expect(screen.getByText("Hold Talkgroup")).toBeInTheDocument();
  });

  it('HOLD dropdown shows "Release System" when heldSystem is set', () => {
    const props = defaultProps();
    props.heldSystem = 42;
    render(<ControlToolbar {...props} />);
    expect(screen.getByText("Release System")).toBeInTheDocument();
  });

  it('HOLD dropdown shows "Release Talkgroup" when heldTG is set', () => {
    const props = defaultProps();
    props.heldTG = 99;
    render(<ControlToolbar {...props} />);
    expect(screen.getByText("Release Talkgroup")).toBeInTheDocument();
  });

  it("calls onHoldSystem when Hold System clicked", () => {
    const props = defaultProps();
    props.currentCallSystemId = 42;
    render(<ControlToolbar {...props} />);
    fireEvent.click(screen.getByText("Hold System"));
    expect(props.onHoldSystem).toHaveBeenCalledWith(42);
  });

  it("calls onHoldTG when Hold Talkgroup clicked", () => {
    const props = defaultProps();
    props.currentCallTgId = 99;
    render(<ControlToolbar {...props} />);
    fireEvent.click(screen.getByText("Hold Talkgroup"));
    expect(props.onHoldTG).toHaveBeenCalledWith(99);
  });

  it("AVOID dropdown shows duration options", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} />);
    expect(screen.getByText("30 minutes")).toBeInTheDocument();
    expect(screen.getByText("60 minutes")).toBeInTheDocument();
    expect(screen.getByText("120 minutes")).toBeInTheDocument();
    expect(screen.getByText("Permanent")).toBeInTheDocument();
  });

  it("calls onAddAvoid with correct entry when avoid option clicked", () => {
    const props = defaultProps();
    props.currentCallTgId = 200;
    render(<ControlToolbar {...props} />);
    fireEvent.click(screen.getByText("Permanent"));
    expect(props.onAddAvoid).toHaveBeenCalledWith({
      talkgroupId: 200,
      expiresAt: 0,
    });
  });

  it("disables the transport controls while background audio is on", () => {
    const props = defaultProps();
    render(
      <ControlToolbar
        {...props}
        backgroundAudio
        streamState="playing"
        onToggleBackgroundAudio={vi.fn()}
      />,
    );

    // These act on the local player, which is released while the server
    // stream owns playback — leaving them live would offer controls that
    // silently do nothing.
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
  });

  it("leaves the transport controls usable when background audio is off", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} />);

    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
  });

  it("only offers the background-audio control when the page provides it", () => {
    const props = defaultProps();
    const { rerender } = render(<ControlToolbar {...props} />);
    // Desktop: the page passes no handler, so the control is absent.
    expect(
      screen.queryByRole("button", { name: "Background audio" }),
    ).not.toBeInTheDocument();

    rerender(<ControlToolbar {...props} onToggleBackgroundAudio={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Background audio" }),
    ).toBeInTheDocument();
  });

  it("disables HOLD while background audio is on", () => {
    const props = defaultProps();
    render(
      <ControlToolbar
        {...props}
        backgroundAudio
        streamState="playing"
        onToggleBackgroundAudio={vi.fn()}
      />,
    );

    // The server never sees HOLD, so it cannot filter the stream — an
    // enabled control here would silently do nothing.
    const hold = screen.getByRole("button", { name: "Hold" });
    expect(hold).toHaveAttribute("aria-disabled", "true");
  });

  it("shows LIVE and BKGND as one joined choice on mobile", () => {
    const props = defaultProps();
    render(
      <ControlToolbar
        {...props}
        backgroundAudio={false}
        streamState="idle"
        onToggleBackgroundAudio={vi.fn()}
      />,
    );

    const live = screen.getByRole("button", { name: /LIVE/ });
    const bg = screen.getByRole("button", { name: "Background audio" });
    // Joined, and neither is disabled: they are two modes to pick from,
    // not a control plus a switch that greys the other one out.
    expect(live.className).toContain("join-item");
    expect(bg.className).toContain("join-item");
    expect(live).toBeEnabled();
    expect(bg).toBeEnabled();
  });

  it("leaves LIVE enabled while streaming so the mode can be switched back", () => {
    const props = defaultProps();
    render(
      <ControlToolbar
        {...props}
        backgroundAudio
        streamState="playing"
        onToggleBackgroundAudio={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /LIVE/ })).toBeEnabled();
  });

  it("disables Replay when there is no Call to replay", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} canReplay={false} />);
    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
  });

  it("lights SELECT and SEARCH while their panels are open", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} selectOpen searchOpen={false} />);
    expect(screen.getByText("SELECT").closest("button")!.className).toContain(
      "btn-primary",
    );
    expect(
      screen.getByText("SEARCH").closest("button")!.className,
    ).not.toContain("btn-primary");
  });

  it("lights AVOID when the current talkgroup is avoided", () => {
    const props = defaultProps();
    render(<ControlToolbar {...props} isAvoided />);
    expect(screen.getByRole("button", { name: "Avoid" }).className).toContain(
      "btn-primary",
    );
  });
});
