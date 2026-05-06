import { configureStore } from "@reduxjs/toolkit";
import sttmBuilderReducer from "@/features/sttm/store/sttm-builder-slice";

export const store = configureStore({
  reducer: {
    sttmBuilder: sttmBuilderReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

