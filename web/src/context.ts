import { createContext, useContext } from "react";
import type { Milestone } from "./types";
import type { TimeScale } from "./time";

export interface AppActions {
  scale: TimeScale;
  /** Navigate to a taxon. */
  go: (id: number) => void;
  /** Select a geologic unit; optionally zoom the timeline to it and place the cursor at T. */
  selectUnit: (name: string, zoom?: boolean, T?: number) => void;
  selectMilestone: (m: Milestone) => void;
  /** Select the most specific unit containing T and scroll the time panel into view. */
  jumpToTime: (T: number) => void;
}

export const AppContext = createContext<AppActions | null>(null);

export function useApp(): AppActions {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppContext");
  return ctx;
}
