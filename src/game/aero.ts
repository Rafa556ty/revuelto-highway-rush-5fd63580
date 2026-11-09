export type AeroState = { lift: number; tilt: number };
export function stepAero(state: AeroState, speed: number, braking: boolean, dt: number): AeroState {
  const deployed = speed > 120 ? 1 : speed < 65 ? 0 : state.lift;
  const lift = state.lift + (deployed - state.lift) * (1 - Math.exp(-1.2 * dt));
  const targetTilt = braking && speed > 15 ? -0.18 : 0;
  return { lift, tilt: state.tilt + (targetTilt - state.tilt) * (1 - Math.exp(-2 * dt)) };
}

/** Metres the traffic Bugatti's wing rises when fully deployed. */
export const TRAFFIC_WING_RISE = 0.2;
/** Angle of attack (radians, trailing edge up) at full deployment. */
export const TRAFFIC_WING_TILT = -0.16;
/**
 * Traffic Bugatti wing: up while the car is racing (a push or an overtake),
 * flush with the tail while it just cruises. Rises/retracts gradually.
 */
export function stepTrafficWing(lift: number, racing: boolean, dt: number): number {
  const target = racing ? 1 : 0;
  return lift + (target - lift) * (1 - Math.exp(-(racing ? 1.6 : 1.1) * dt));
}
