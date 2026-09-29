import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessagesTab from "./MessagesTab";
import { tallyMessage, type MessageTally } from "./trunk";
import type { MessageEntry } from "./types";

// A busy control channel: many messages share a millisecond, an opcode and a
// system, and only `seq` tells them apart.
function burst(from: number, n: number): MessageEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: from + i,
    at: 1_790_000_000_000 + Math.floor((from + i) / 10),
    topic: "tr.message",
    type: i % 2 ? "UPDATE" : "UNKNOWN",
    opcode: i % 2 ? "02" : "3C",
    shortname: "MARCSLake",
    raw: null,
  }));
}

function tallies(messages: MessageEntry[]): Record<string, MessageTally> {
  const t: Record<string, MessageTally> = {};
  for (const m of messages) tallyMessage(t, m);
  return t;
}

const bodyRows = (name: string) => within(within(screen.getByRole("table", { name })).getAllByRole("rowgroup")[1]).getAllByRole("row");

describe("MessagesTab", () => {
  it("shows one page of Live and comes back to By opcode still counting", async () => {
    const user = userEvent.setup();
    const first = burst(1, 300);
    const { rerender } = render(<MessagesTab messages={first} tallies={tallies(first)} />);
    expect(bodyRows("Messages by opcode")).toHaveLength(2);

    await user.click(screen.getByRole("radio", { name: /Live/ }));
    expect(bodyRows("Live messages")).toHaveLength(20);

    await user.click(screen.getByRole("radio", { name: /By opcode/ }));
    // Only the two opcode rows: nothing left over from the Live table.
    expect(bodyRows("Messages by opcode")).toHaveLength(2);
    expect(bodyRows("Messages by opcode")[0]).toHaveTextContent("150");

    const more = [...first, ...burst(301, 100)];
    rerender(<MessagesTab messages={more} tallies={tallies(more)} />);
    expect(bodyRows("Messages by opcode")).toHaveLength(2);
    expect(bodyRows("Messages by opcode")[0]).toHaveTextContent("200");
  });
});
