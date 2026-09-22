import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HistoryPanel } from "./HistoryPanel";
import { audioPlayer } from "@/shared/services/audio/player";
import type { Call } from "../types";

function makeCall(overrides: Partial<Call> = {}): Call {
  return {
    id: 1,
    audioName: "a.wav",
    audioType: "audio/wav",
    dateTime: 1_700_000_000,
    systemId: 1,
    system: 1,
    talkgroupId: 101,
    talkgroup: 1,
    talkgroupName: "Fire Dispatch",
    ...overrides,
  };
}

describe("HistoryPanel", () => {
  it("renders nothing without history", () => {
    const { container } = render(
      <HistoryPanel history={[]} time12hFormat={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("replays a Call when its row is tapped", () => {
    const playNow = vi
      .spyOn(audioPlayer, "playNow")
      .mockImplementation(() => {});
    const call = makeCall();
    render(<HistoryPanel history={[call]} time12hFormat={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: /replay fire dispatch/i }),
    );
    expect(playNow).toHaveBeenCalledWith(call);
    playNow.mockRestore();
  });

  it("marks the row on the air", () => {
    render(
      <HistoryPanel
        history={[
          makeCall({ id: 1 }),
          makeCall({ id: 2, talkgroupName: "Police" }),
        ]}
        time12hFormat={false}
        playingCallId={2}
      />,
    );
    expect(
      screen.getByRole("button", { name: /replay police/i }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: /replay fire dispatch/i }),
    ).not.toHaveAttribute("aria-current");
  });

  it("shows at most five rows", () => {
    const history = Array.from({ length: 8 }, (_, i) =>
      makeCall({ id: i + 1 }),
    );
    render(<HistoryPanel history={history} time12hFormat={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });
});
