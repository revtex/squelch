import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DataTable, type Column } from "./DataTable";

interface Row {
  id: number;
  name: string;
  calls: number;
}

const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  name: `user${String(i + 1).padStart(2, "0")}`,
  calls: (i * 7) % 11,
}));

const columns: Column<Row>[] = [
  { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  {
    id: "calls",
    header: "Calls",
    cell: (r) => r.calls,
    sortValue: (r) => r.calls,
    align: "right",
  },
];

function bodyNames(): string[] {
  const body = screen.getByRole("table").querySelector("tbody");
  return Array.from(body?.querySelectorAll("tr") ?? []).map(
    (tr) => tr.querySelector("td[data-label='Name']")?.textContent ?? "",
  );
}

function Selectable() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  return (
    <DataTable
      caption="Users"
      columns={columns}
      rows={rows.slice(0, 3)}
      rowKey={(r) => r.id}
      selected={selected}
      onSelectedChange={setSelected}
      bulkActions={<button type="button">Delete</button>}
      rowLabel={(r) => r.name}
    />
  );
}

describe("DataTable", () => {
  it("pages 25 rows at a time and moves between pages", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    );
    expect(bodyNames()).toHaveLength(25);
    expect(screen.getByText("Showing 1–25 of 30")).toBeInTheDocument();
    // The first page offers only Next; the last only Previous.
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(bodyNames()).toHaveLength(5);
    expect(bodyNames()[0]).toBe("user26");
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(bodyNames()[0]).toBe("user01");
  });

  it("draws every header the same way, sortable or not", () => {
    render(
      <DataTable
        caption="Users"
        columns={[
          ...columns,
          { id: "note", header: "Note", cell: () => "" },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        pageSize={0}
      />,
    );
    const headers = Array.from(
      screen.getByRole("table").querySelectorAll("thead th"),
    );
    // Sortable headers hold a bare button that inherits the header's type,
    // not a DaisyUI button with its own size and weight.
    for (const th of headers) {
      for (const b of Array.from(th.querySelectorAll("button"))) {
        expect(b.className).not.toMatch(/\bbtn\b|font-(semibold|bold)/);
      }
    }
    expect(screen.getByRole("columnheader", { name: "Note" })).toBeInTheDocument();
  });

  it("sorts by a column, then the other way", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        caption="Users"
        columns={columns}
        rows={rows.slice(0, 5)}
        rowKey={(r) => r.id}
        pageSize={0}
      />,
    );
    const header = screen.getByRole("button", { name: "Calls" });
    await user.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "ascending");
    const calls = rows.slice(0, 5).map((r) => r.calls).sort((a, b) => a - b);
    const shown = Array.from(
      screen.getByRole("table").querySelectorAll("td[data-label='Calls']"),
    ).map((td) => Number(td.textContent));
    expect(shown).toEqual(calls);
    await user.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "descending");
  });

  it("ticks rows and shows the bulk bar with a count", async () => {
    const user = userEvent.setup();
    render(<Selectable />);
    expect(screen.queryByRole("region", { name: "Selected rows" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Select user01" }));
    const bar = screen.getByRole("region", { name: "Selected rows" });
    expect(bar).toHaveTextContent("1 selected");
    expect(within(bar).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all on this page" }),
    );
    expect(bar).toHaveTextContent("3 selected");
    await user.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("region", { name: "Selected rows" })).toBeNull();
  });

  it("opens a row's details from its button and marks it open", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <DataTable
        caption="Users"
        columns={columns}
        rows={rows.slice(0, 2)}
        rowKey={(r) => r.id}
        onOpen={onOpen}
        rowLabel={(r) => r.name}
        openKey={2}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Details for user01" }));
    expect(onOpen).toHaveBeenCalledWith(rows[0], expect.any(HTMLElement));
    expect(
      screen.getByRole("button", { name: "Details for user02" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the empty message when there are no rows", () => {
    render(
      <DataTable
        caption="Users"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty="No users match."
      />,
    );
    expect(screen.getByText("No users match.")).toBeInTheDocument();
  });
});
