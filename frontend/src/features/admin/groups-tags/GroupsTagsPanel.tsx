import { TriangleAlert } from "lucide-react";
import {
  Notice,
  PageHeader,
  useCreateGroupMutation,
  useCreateTagMutation,
  useDeleteGroupMutation,
  useDeleteTagMutation,
  useListGroupsQuery,
  useListTagsQuery,
  useUpdateGroupMutation,
  useUpdateTagMutation,
} from "@/features/admin/_shell";
import LabelCard from "./LabelCard";

/** Groups and tags: two label lists, edited in place. */
export default function GroupsTagsPanel() {
  const { data: groups, isLoading: loadingGroups } = useListGroupsQuery();
  const [createGroup] = useCreateGroupMutation();
  const [updateGroup] = useUpdateGroupMutation();
  const [deleteGroup] = useDeleteGroupMutation();

  const { data: tags, isLoading: loadingTags } = useListTagsQuery();
  const [createTag] = useCreateTagMutation();
  const [updateTag] = useUpdateTagMutation();
  const [deleteTag] = useDeleteTagMutation();

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="Groups & tags"
        subtitle="Groups sort talkgroups in the scanner's picker. Tags are a second label for filtering. Add and rename in place."
      />
      <div className="grid items-start gap-[18px] lg:grid-cols-2">
        <LabelCard
          kind="group"
          title="Groups"
          help="Fire, Law, EMS: the headings listeners pick from."
          items={groups}
          loading={loadingGroups}
          onCreate={(label) => createGroup({ label }).unwrap()}
          onRename={(id, label) => updateGroup({ id, label }).unwrap()}
          onDelete={(payload) => deleteGroup(payload).unwrap()}
        />
        <LabelCard
          kind="tag"
          title="Tags"
          help="Dispatch, Tac, Interop: a finer label for filtering."
          items={tags}
          loading={loadingTags}
          onCreate={(label) => createTag({ label }).unwrap()}
          onRename={(id, label) => updateTag({ id, label }).unwrap()}
          onDelete={(payload) => deleteTag(payload).unwrap()}
        />
      </div>
      <Notice tone="warn" icon={<TriangleAlert />}>
        Deleting a group or tag that is in use asks where its talkgroups should go (another one, or none)
        instead of leaving them pointing at a missing ID.
      </Notice>
    </div>
  );
}
