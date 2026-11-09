// GP practice driving model (pure TypeScript, no three.js / React).
// Longitudinal feel is copied 1:1 from the highway game (engine.ts): same
// acceleration curve, brakes, coasting and 8-speed gearbox. Steering is a
// real yaw model (free track instead of lanes) limited by tyre grip.
import { pickGear } from "./gearbox";
import type { Surface } from "./gp-track";

/** Same numbers as engine.ts. */
export const MAX_SPEED = 352; // km/h
export const ACCEL = 68; // km/h per s
export const BRAKE = 135;
export const COAST = 8;

export const REVERSE_MAX = 30; // km/h
export const REVERSE_ACCEL = 22;
export const WHEELBASE = 2.7; // m
/** Front wheel angle at a standstill (rad); shrinks with speed like the original's heavier steering. */
export const MAX_STEER = 0.6;
export const STEER_FADE = 17; // m/s at which steering angle halves
export const STEER_IN = 7;
export const STEER_OUT = 10;
/** Lateral grip in g per surface; slicks on asphalt, much less on grass / gravel. */
export const GRIP: Record<Surface, number> = { road: 1.35, grass: 0.55, gravel: 0.45 };
/** Extra rolling drag off the asphalt (km/h per s): base + k * speed. */
export const SURFACE_DRAG: Record<Surface, { base: number; k: number }> = {
  road: { base: 0, k: 0 },
  grass: { base: 10, k: 0.22 },
  gravel: { base: 22, k: 0.4 },
};
/** Aero downforce (m/s² of extra grip per (m/s)²) on asphalt. */
export const DOWNFORCE = 0.0022;
/** How fast the tyres kill sideways sliding (1/s). */
export const LAT_K = 9;
export const G = 9.81;

export type DriveInput = { left: boolean; right: boolean; gas: boolean; brake: boolean };

export type DriveState = {
  /** forward / sideways speed in the car's frame, m/s (+right) */
  vF: number;
  vL: number;
  heading: number;
  /** smoothed steering -1 (left) .. 1 (right) */
  steer: number;
  /** 1-based gear, 0 = reverse */
  gear: number;
  /** 0..1 tyre slip, for screech and smoke */
  slip: number;
  yawRate: number;
};

export function newDriveState(heading: number): DriveState {
  return { vF: 0, vL: 0, heading, steer: 0, gear: 1, slip: 0, yawRate: 0 };
}

export const kmh = (s: DriveState) => Math.abs(s.vF) * 3.6;

/** Car-frame unit vectors: the model faces -Z at heading 0. */
export function forward(h: number) {
  return { x: -Math.sin(h), z: -Math.cos(h) };
}
export function right(h: number) {
  return { x: Math.cos(h), z: -Math.sin(h) };
}

/**
 * Advance the car one step. `slope` = sine of the road pitch (uphill > 0).
 * Returns true when the gearbox upshifted under throttle (exhaust pop).
 */
export function stepDrive(
  s: DriveState,
  inp: DriveInput,
  surface: Surface,
  slope: number,
  dt: number,
): boolean {
  let v = s.vF * 3.6; // km/h, signed
  const speed = Math.abs(v);
  let a: number;
  if (inp.brake) {
    a = v > 1.5 ? -BRAKE : -REVERSE_ACCEL;
  } else if (inp.gas) {
    a = v < -1.5 ? BRAKE : ACCEL * (1 - (Math.max(0, v) / MAX_SPEED) ** 2) + 3.5;
  } else {
    a = -Math.sign(v) * (COAST + speed * 0.04);
  }
  const drag = SURFACE_DRAG[surface];
  a -= Math.sign(v) * (drag.base + drag.k * speed);
  a -= G * slope * 3.6;
  const before = v;
  v += a * dt;
  // Coasting / drag never pushes the car backwards through zero.
  if (!inp.brake && !inp.gas && Math.sign(v) !== Math.sign(before) && before !== 0) v = 0;
  if (inp.gas && before >= 0 && v < 0 && slope <= 0) v = 0;
  if (inp.brake && before > 0 && v < 0) v = 0;
  v = Math.max(-REVERSE_MAX, Math.min(MAX_SPEED, v));
  s.vF = v / 3.6;

  // Gearbox (same 8-speed box as the Revuelto).
  let shifted = false;
  if (s.vF < -0.3) s.gear = 0;
  else {
    const g = pickGear(Math.max(0, s.gear - 1), Math.abs(v), inp.gas) + 1;
    if (g > s.gear && s.gear > 0 && inp.gas) shifted = true;
    s.gear = g;
  }

  // Steering: smoothed input, angle fades with speed.
  const target = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const rate = target === 0 || Math.sign(target) !== Math.sign(s.steer) ? STEER_OUT : STEER_IN;
  s.steer += (target - s.steer) * (1 - Math.exp(-rate * dt));
  const vAbs = Math.abs(s.vF);
  const angle = (s.steer * MAX_STEER) / (1 + vAbs / STEER_FADE);
  const want = (s.vF * Math.tan(angle)) / WHEELBASE;
  const aMax = G * GRIP[surface] + (surface === "road" ? DOWNFORCE * vAbs * vAbs : 0);
  const maxYaw = aMax / Math.max(vAbs, 1);
  const yaw = Math.max(-maxYaw, Math.min(maxYaw, want));
  s.yawRate = yaw;
  s.heading -= yaw * dt; // steering right turns clockwise seen from above

  // Velocity stays put in the world while the body turns, then the tyres
  // pull the sideways part back in, limited by grip.
  s.vL += s.vF * yaw * dt;
  const pull = Math.min(Math.abs(s.vL) * LAT_K, aMax) * dt;
  s.vL = Math.abs(s.vL) <= pull ? 0 : s.vL - Math.sign(s.vL) * pull;

  const under = Math.abs(want) > maxYaw ? Math.min(1, (Math.abs(want) - maxYaw) / maxYaw) : 0;
  const brakeSlip = inp.brake && s.vF * 3.6 > 35 ? Math.min(1, (s.vF * 3.6) / 180) : 0;
  s.slip = Math.max(under * Math.min(1, vAbs / 15), Math.min(1, Math.abs(s.vL) / 4), brakeSlip);
  return shifted;
}

/**
 * Hitting a wall whose outward normal is (nx, nz): the part of the velocity
 * going into the wall bounces back weakly, the car scrubs speed along it.
 * Returns the impact speed in m/s.
 */
export function bounceOffWall(s: DriveState, nx: number, nz: number): number {
  const f = forward(s.heading);
  const r = right(s.heading);
  let wx = f.x * s.vF + r.x * s.vL;
  let wz = f.z * s.vF + r.z * s.vL;
  const vn = wx * nx + wz * nz;
  if (vn >= 0) return 0;
  const impact = -vn;
  wx -= 1.25 * vn * nx;
  wz -= 1.25 * vn * nz;
  const scrub = 1 - Math.min(0.5, impact / 40);
  wx *= scrub;
  wz *= scrub;
  s.vF = wx * f.x + wz * f.z;
  s.vL = wx * r.x + wz * r.z;
  return impact;
}
