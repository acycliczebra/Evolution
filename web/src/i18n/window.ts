import type { TimeWindow } from "../sync";
import type { I18n } from "./index";
import type { MsgKey } from "./en";

/** Message for a time window, in its "unit" form (the Cretaceous) or "instant" form (69 Ma). */
export function winMsg(i: I18n, w: TimeWindow, unitKey: MsgKey, atKey: MsgKey, vars: Record<string, string | number> = {}): string {
  return w.unit ? i.t(unitKey, { ...vars, unit: i.unitName(w.unit) }) : i.t(atKey, { ...vars, time: i.fmtShort(w.start) });
}
