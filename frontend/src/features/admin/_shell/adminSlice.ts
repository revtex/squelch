import { api } from "@/app/api";
import type { LabelImportPreview, TalkgroupImportPreview, UnitImportPreview } from "@/types";

// --- Admin RTK Query endpoints (file-upload only; all other admin ops use WebSocket) ---

const adminApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // ── Import (multipart file uploads — cannot use WebSocket) ──
    importTalkgroups: builder.mutation<
      {
        inserted: number;
        updated: number;
        skipped: number;
        failed?: number;
        message?: string;
      },
      FormData
    >({
      query: (body) => ({
        url: "/admin/import/talkgroups",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Talkgroups"],
    }),
    importUnits: builder.mutation<
      {
        inserted: number;
        updated: number;
        skipped: number;
        failed?: number;
      },
      FormData
    >({
      query: (body) => ({
        url: "/admin/import/units",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Units"],
    }),
    importGroups: builder.mutation<
      {
        inserted: number;
        skipped: number;
        failed?: number;
        message?: string;
      },
      FormData
    >({
      query: (body) => ({
        url: "/admin/import/groups",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Groups"],
    }),
    importTags: builder.mutation<
      {
        inserted: number;
        skipped: number;
        failed?: number;
        message?: string;
      },
      FormData
    >({
      query: (body) => ({
        url: "/admin/import/tags",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Tags"],
    }),

    // ── Reviewed CSV imports: the preview reads the file, the WS op applies it ──
    previewTalkgroupImport: builder.mutation<TalkgroupImportPreview, FormData>({
      query: (body) => ({
        url: "/admin/import/talkgroups/preview",
        method: "POST",
        body,
      }),
    }),
    previewUnitImport: builder.mutation<UnitImportPreview, FormData>({
      query: (body) => ({
        url: "/admin/import/units/preview",
        method: "POST",
        body,
      }),
    }),
    previewGroupImport: builder.mutation<LabelImportPreview, FormData>({
      query: (body) => ({
        url: "/admin/import/groups/preview",
        method: "POST",
        body,
      }),
    }),
    previewTagImport: builder.mutation<LabelImportPreview, FormData>({
      query: (body) => ({
        url: "/admin/import/tags/preview",
        method: "POST",
        body,
      }),
    }),
  }),
});

export const {
  useImportTalkgroupsMutation,
  useImportUnitsMutation,
  useImportGroupsMutation,
  useImportTagsMutation,
  usePreviewTalkgroupImportMutation,
  usePreviewUnitImportMutation,
  usePreviewGroupImportMutation,
  usePreviewTagImportMutation,
} = adminApi;
