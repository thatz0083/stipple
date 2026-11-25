// Measurement override — pins every Stipple cloud call (answers AND the hidden
// summary call) to one provider + temperature while a measurement run is in
// progress, so the Stipple arm and the "model direct" arm hit the same model
// under the same sampling settings. Unset (the default) changes nothing.
//
// Client-side module state only; the model itself is still resolved
// server-side from env (see providers/config.ts).

import type { ProviderId } from "./providers/types";

export type CallOverride = {
  provider?: ProviderId;
  temperature?: number;
  maxOutputTokens?: number;
};

let current: CallOverride = {};

export function setCallOverride(next: CallOverride | null): void {
  current = next ?? {};
}

export function getCallOverride(): CallOverride {
  return current;
}
