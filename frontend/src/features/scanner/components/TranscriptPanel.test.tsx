import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TranscriptPanel } from "./TranscriptPanel";
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
    transcript: "Engine 5 responding. Copy.",
    transcriptSegments: [
      { start: 0, end: 2, text: " Engine 5 responding." },
      { start: 2.5, end: 3, text: " Copy." },
    ],
    ...overrides,
  };
}

describe("TranscriptPanel", () => {
  it("counts lines in the header", () => {
    render(<TranscriptPanel call={makeCall()} position={0} playing={false} />);
    expect(screen.getByText("2 LINES")).toBeInTheDocument();
  });

  it("counts speakers when the transcript is diarized", () => {
    const call = makeCall({
      transcriptSegments: [
        {
          start: 0,
          end: 2,
          text: "Engine 5 responding.",
          speaker: "SPEAKER_00",
        },
        { start: 2.5, end: 3, text: "Copy.", speaker: "SPEAKER_01" },
      ],
    });
    render(<TranscriptPanel call={call} position={0} playing={false} />);
    expect(screen.getByText("2 SPEAKERS")).toBeInTheDocument();
    expect(screen.getByText("Speaker 2")).toBeInTheDocument();
  });

  it("marks the line being spoken", () => {
    render(<TranscriptPanel call={makeCall()} position={2.7} playing />);
    const current = screen.getByText("Copy.").closest("[aria-current]");
    expect(current).not.toBeNull();
    expect(
      screen.getByText("Engine 5 responding.").closest("[aria-current]"),
    ).toBeNull();
  });

  it("collapses and expands from the header", () => {
    render(<TranscriptPanel call={makeCall()} position={0} playing={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide transcript" }));
    expect(screen.queryByText("Copy.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show transcript" }));
    expect(screen.getByText("Copy.")).toBeInTheDocument();
  });
});
