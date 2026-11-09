// Which control layout to show: on-screen pedals (phone) or keyboard (PC).
export type UiPref = "auto" | "pc" | "touch";
export type UiMode = "pc" | "touch";

export function detectUi(d: { touchPoints: number; coarse: boolean; width: number }): UiMode {
  if (d.coarse) return "touch";
  if (d.touchPoints > 0 && d.width < 1024) return "touch";
  return "pc";
}

export function resolveUi(pref: UiPref, detected: UiMode): UiMode {
  return pref === "auto" ? detected : pref;
}

/**
 * Sun shadow offset under the car (metres, x/z). The sun's bearing drifts as
 * the road winds, so the shadow slides from under the car to its side; in the
 * tunnel each passing ceiling lamp sweeps it from front to back.
 */
export function shadowOffset(pz: number, tunnel: boolean, night: number) {
  if (tunnel) {
    const phase = ((pz % 24) + 24) % 24 / 24; // one lamp every 24 m
    return { x: 0.15, z: (phase - 0.5) * 2.4, strength: 0.55 };
  }
  const bearing = Math.sin(pz / 900) * 0.9 + Math.sin(pz / 310) * 0.35;
  const len = 0.55 + 0.45 * Math.abs(Math.sin(pz / 1400));
  return {
    x: Math.sin(bearing) * len,
    z: Math.cos(bearing) * len * 0.5,
    strength: 0.75 * (1 - night * 0.85),
  };
}
