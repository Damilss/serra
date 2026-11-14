// The sound model behind simulated alerts. Loudness follows the wire format (firmware/mesh/packet.h,
// base-station README): peak_level is a calibrated level in tenths of a dB (853 = 85.3 dB), on a
// scale where the calibration tone reads 80 dB on every node.
//
// A call fades with distance by inverse-square spreading (−6 dB per doubling of distance) plus a
// little terrain and air absorption, and a node only reports it if the level reaching it clears the
// wake trigger.

import type { AlertClass } from './types';

/** Below this a node never wakes the classifier, dB. */
export const TRIGGER_DB = 50;
/** Level REF_M metres from the caller, dB. */
export const CALL_DB: Record<AlertClass, number> = { whistle: 90, scream: 86, help: 82 };
/** The caller is about this far from the nearest node, metres. */
export const REF_M = 20;
/** Terrain, foliage and air, dB per metre. */
export const ABSORB_DB_PER_M = 0.01;

/** Level of a call of class `cls` heard `m` metres from the caller, dB. */
export const levelAt = (cls: AlertClass, m: number) =>
  CALL_DB[cls] - 20 * Math.log10(Math.max(m, REF_M) / REF_M) - ABSORB_DB_PER_M * m;
