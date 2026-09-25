import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import GroupsTagsPanel from "./GroupsTagsPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { AdminGroup, AdminTag } from "@/types";

const groups: AdminGroup[] = [
  { id: 1, label: "Fire", talkgroups: 3 },
  { id: 2, label: "Law", talkgroups: 0 },
  { id: 3, label: "EMS", talkgroups: 1 },
];
const tags: AdminTag[] = [{ id: 10, label: "Dispatch", talkgroups: 2 }];

type Op = (arg: unknown) => Promise<unknown>;
const createGroup = vi.fn<Op>();
const updateGroup = vi.fn<Op>();
const deleteGroup = vi.fn<Op>();
const deleteTag = vi.fn<Op>();
const mutation = (fn: Op) => [
  (arg: unknown) => ({ unwrap: () => fn(arg) }),
  { isLoading: false, isError: false },
];

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useListGroupsQuery: () => ({ data: groups, isLoading: false }),
  useListTagsQuery: () => ({ data: tags, isLoading: false }),
  useCreateGroupMutation: () => mutation(createGroup),
  useUpdateGroupMutation: () => mutation(updateGroup),
  useDeleteGroupMutation: () => mutation(deleteGroup),
  useCreateTagMutation: () => mutation(vi.fn()),
  useUpdateTagMutation: () => mutation(vi.fn()),
  useDeleteTagMutation: () => mutation(deleteTag),
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <GroupsTagsPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const groupList = () => within(screen.getByRole("list", { name: "Groups" }));

describe("GroupsTagsPanel", () => {
  beforeEach(() => {
    for (const op of [createGroup, updateGroup, deleteGroup, deleteTag]) {
      op.mockReset().mockResolvedValue({ ok: true, moved: 0 });
    }
  });

  it("lists groups and tags with how many talkgroups use them", () => {
    renderPanel();
    const fire = groupList().getByText("Fire").closest("li")!;
    expect(
      within(fire).getByRole("link", { name: "Show 3 talkgroups in Fire" }),
    ).toHaveAttribute("href", "/admin/systems?group=1");
    const law = groupList().getByText("Law").closest("li")!;
    expect(within(law).getByText("unused")).toBeInTheDocument();
    expect(screen.getByText("Dispatch")).toBeInTheDocument();
  });

  it("adds a group from the inline row", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText("New group"), "  Public Works ");
    await user.click(screen.getByRole("button", { name: "Add group" }));
    expect(createGroup).toHaveBeenCalledWith({ label: "Public Works" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      'Added group "Public Works".',
    );
  });

  it("renames in place and saves on Enter", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Rename Law" }));
    const input = screen.getByLabelText("New name for Law");
    await user.clear(input);
    await user.type(input, "Police{Enter}");
    expect(updateGroup).toHaveBeenCalledWith({ id: 2, label: "Police" });
  });

  it("deletes an unused group and offers an undo that recreates it", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Delete Law" }));
    const confirm = within(screen.getByRole("group", { name: "Confirm" }));
    expect(confirm.getByText(/Nothing uses it/)).toBeInTheDocument();
    await user.click(confirm.getByRole("button", { name: "Delete" }));
    expect(deleteGroup).toHaveBeenCalledWith({ id: 2 });
    const toast = await screen.findByRole("status");
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(createGroup).toHaveBeenCalledWith({ label: "Law" });
  });

  it("asks where the talkgroups go before deleting a group in use", async () => {
    const user = userEvent.setup();
    deleteGroup.mockResolvedValue({ ok: true, moved: 3 });
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Delete Fire" }));
    const confirm = within(screen.getByRole("group", { name: "Confirm" }));
    expect(confirm.getByText(/3 talkgroups use it/)).toBeInTheDocument();
    const select = confirm.getByLabelText("Move its talkgroups to");
    expect(within(select).queryByRole("option", { name: "Fire" })).toBeNull();
    await user.selectOptions(select, "EMS");
    await user.click(confirm.getByRole("button", { name: "Move and delete" }));
    expect(deleteGroup).toHaveBeenCalledWith({ id: 1, reassign: true, moveTo: 3 });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "3 talkgroups moved to EMS",
    );
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("shows a server error under the row and keeps the row", async () => {
    deleteTag.mockRejectedValueOnce(new Error("2 talkgroups use this tag"));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Delete Dispatch" }));
    const confirm = within(screen.getByRole("group", { name: "Confirm" }));
    await act(async () => {
      fireEvent.click(confirm.getByRole("button", { name: "Move and delete" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "2 talkgroups use this tag",
    );
    expect(screen.getByText("Dispatch")).toBeInTheDocument();
  });
});
