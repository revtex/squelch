import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { api } from "@/app/api";
import type { AvoidEntry, SetupStatus } from "@/types";
import type {
  LoginResponse,
  RefreshResponse,
  ChangePasswordRequest,
  ListenerPreferences,
} from "./types";

interface AuthState {
  token: string | null;
  role: string | null;
  username: string | null;
  passwordNeedChange: boolean;
  setupStatus: SetupStatus | null;
  authReady: boolean;
}

const initialState: AuthState = {
  token: null,
  role: null,
  username: null,
  passwordNeedChange: false,
  setupStatus: null,
  authReady: false,
};

export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setCredentials(
      state,
      action: PayloadAction<{
        token: string;
        role: string;
        username: string;
        passwordNeedChange: boolean;
      }>,
    ) {
      state.token = action.payload.token;
      state.role = action.payload.role;
      state.username = action.payload.username;
      state.passwordNeedChange = action.payload.passwordNeedChange;
    },
    clearCredentials(state) {
      state.token = null;
      state.role = null;
      state.username = null;
      state.passwordNeedChange = false;
    },
    setSetupStatus(state, action: PayloadAction<SetupStatus>) {
      state.setupStatus = action.payload;
    },
    setAuthReady(state) {
      state.authReady = true;
    },
  },
});

export const {
  setCredentials,
  clearCredentials,
  setSetupStatus,
  setAuthReady,
} = authSlice.actions;

export const selectToken = (state: { auth: AuthState }) => state.auth.token;
export const selectRole = (state: { auth: AuthState }) => state.auth.role;
export const selectUsername = (state: { auth: AuthState }) =>
  state.auth.username;
export const selectAuthReady = (state: { auth: AuthState }) =>
  state.auth.authReady;

// ── Auth RTK Query endpoints ──

const authApi = api.injectEndpoints({
  endpoints: (builder) => ({
    postLogin: builder.mutation<
      LoginResponse,
      { username: string; password: string; rememberMe?: boolean }
    >({
      query: (body) => ({
        url: "/auth/login",
        method: "POST",
        body,
      }),
    }),
    postRefresh: builder.mutation<RefreshResponse, void>({
      query: () => ({
        url: "/auth/refresh",
        method: "POST",
      }),
    }),
    postLogout: builder.mutation<{ ok: boolean }, void>({
      query: () => ({
        url: "/auth/logout",
        method: "POST",
      }),
    }),
    changePassword: builder.mutation<void, ChangePasswordRequest>({
      query: (body) => ({
        url: "/auth/password",
        method: "PUT",
        body,
      }),
    }),
    getTGSelection: builder.query<
      { disabledTGs: number[]; avoidList?: AvoidEntry[]; version?: string },
      void
    >({
      query: () => "/listener/tg-selection",
    }),
    // `version` is the fingerprint read by the last GET/PUT. The server
    // rejects a write carrying a stale one with 409 instead of letting a
    // second tab or device silently overwrite a newer selection.
    updateTGSelection: builder.mutation<
      { ok: boolean; version?: string },
      { disabledTGs: number[]; avoidList: AvoidEntry[]; version?: string }
    >({
      query: (body) => ({
        url: "/listener/tg-selection",
        method: "PUT",
        body,
      }),
    }),
    // A listener's own client settings, kept against the account so they
    // follow the person rather than the browser. A field is absent when it
    // has never been set, which leaves the instance default in force.
    getPreferences: builder.query<ListenerPreferences, void>({
      query: () => "/listener/preferences",
    }),
    updatePreferences: builder.mutation<
      ListenerPreferences,
      ListenerPreferences
    >({
      query: (body) => ({
        url: "/listener/preferences",
        method: "PUT",
        body,
      }),
      // The choice has to apply to this tab as it is made, not after a
      // round trip — the click that picks a beep also plays it.
      async onQueryStarted(body, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          authApi.util.updateQueryData("getPreferences", undefined, (draft) => {
            Object.assign(draft, body);
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),
  }),
});

export const {
  usePostLoginMutation,
  usePostRefreshMutation,
  usePostLogoutMutation,
  useChangePasswordMutation,
  useGetTGSelectionQuery,
  useUpdateTGSelectionMutation,
  useGetPreferencesQuery,
  useUpdatePreferencesMutation,
} = authApi;
