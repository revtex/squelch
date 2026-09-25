import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import { api } from "@/app/api";
import { scannerSlice } from "@/features/scanner";
import { authSlice } from "@/features/auth";
import { callsSlice } from "@/features/scanner";
import { audioListenerMiddleware } from "@/app/audioListenerMiddleware";
import { trMqttReducer } from "@/features/admin/trunk-recorder";

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    scanner: scannerSlice.reducer,
    auth: authSlice.reducer,
    calls: callsSlice.reducer,
    trMqtt: trMqttReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .prepend(audioListenerMiddleware.middleware)
      .concat(api.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

// Re-export so test stores can mount the reducer without crossing the
// sibling-feature ESLint boundary on @/features/admin/trunk-recorder.
export { trMqttReducer };
