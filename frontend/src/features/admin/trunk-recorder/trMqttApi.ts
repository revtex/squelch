import { api } from "@/app/api";
import type {
  TrInstance,
  TrInstanceCreatePayload,
  TrInstanceUpdatePayload,
  TrInstanceTestResponse,
  SnapshotView,
} from "./types";

const trMqttApi = api.injectEndpoints({
  endpoints: (builder) => ({
    listTrInstances: builder.query<TrInstance[], void>({
      query: () => "/admin/tr/instances",
      providesTags: (result) =>
        result
          ? [
              ...result.map((r) => ({
                type: "TrInstances" as const,
                id: r.id,
              })),
              { type: "TrInstances" as const, id: "LIST" },
            ]
          : [{ type: "TrInstances" as const, id: "LIST" }],
    }),
    createTrInstance: builder.mutation<TrInstance, TrInstanceCreatePayload>({
      query: (body) => ({
        url: "/admin/tr/instances",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "TrInstances", id: "LIST" }],
    }),
    updateTrInstance: builder.mutation<
      TrInstance,
      { id: number; body: TrInstanceUpdatePayload }
    >({
      query: ({ id, body }) => ({
        url: `/admin/tr/instances/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (_result, _err, arg) => [
        { type: "TrInstances", id: arg.id },
        { type: "TrInstances", id: "LIST" },
      ],
    }),
    deleteTrInstance: builder.mutation<void, number>({
      query: (id) => ({
        url: `/admin/tr/instances/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_result, _err, id) => [
        { type: "TrInstances", id },
        { type: "TrInstances", id: "LIST" },
      ],
    }),
    testTrInstance: builder.mutation<TrInstanceTestResponse, number>({
      query: (id) => ({
        url: `/admin/tr/instances/${id}/test`,
        method: "POST",
      }),
    }),
    reconnectTrInstance: builder.mutation<void, number>({
      query: (id) => ({
        url: `/admin/tr/instances/${id}/reconnect`,
        method: "POST",
      }),
      invalidatesTags: (_r, _e, id) => [{ type: "TrInstances", id }],
    }),
    getTrSnapshot: builder.query<SnapshotView, number>({
      query: (id) => `/admin/tr/instances/${id}/snapshot`,
    }),
  }),
});

export const {
  useListTrInstancesQuery,
  useCreateTrInstanceMutation,
  useUpdateTrInstanceMutation,
  useDeleteTrInstanceMutation,
  useTestTrInstanceMutation,
  useReconnectTrInstanceMutation,
  useGetTrSnapshotQuery,
  useLazyGetTrSnapshotQuery,
} = trMqttApi;

export { trMqttApi };
