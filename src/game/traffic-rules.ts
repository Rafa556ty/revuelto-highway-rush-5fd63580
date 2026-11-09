import type { CarType } from "./traffic";

// Spawn beyond the fog, retain fast traffic even when it drives into the distance.
export const TRAFFIC_SPAWN_AHEAD = 290;
export const TRAFFIC_KEEP_AHEAD = 650;
// Passed cars stay alive far behind so the reverse camera can show them.
export const TRAFFIC_KEEP_BEHIND = 115;
export const TRAFFIC_DRAW_AHEAD = 285;
/** The Mustang slot (60% lower than the old two-of-three palette). */
export const SPORT_SLOT = (2 / 3) * 0.4;
/** Share of the old Mustang slot now driven by Porsche 911 GT3s (some, not all). */
export const PORSCHE_SHARE = 0.4;
export const MUSTANG_CHANCE = SPORT_SLOT * (1 - PORSCHE_SHARE);
export const PORSCHE_CHANCE = SPORT_SLOT * PORSCHE_SHARE;
/** BMW M3 Competition: as rare as one colour of the old Mustang slot. */
export const BMW_CHANCE = SPORT_SLOT / 2;
/** Bugatti Chiron: the rarest car on the road. */
export const BUGATTI_CHANCE = BMW_CHANCE / 3;
/** Ferrari SF90 Stradale: rare, but more common than the Bugatti. */
export const FERRARI_CHANCE = BMW_CHANCE / 2;
const SPORT = new Set<CarType>([
  "mustang-blue",
  "mustang-black",
  "bmw-m3",
  "porsche-gt3",
  "bugatti-chiron",
  "ferrari-sf90",
]);
export const isSportCar = (t?: CarType) => !!t && SPORT.has(t);

export type SportPush = { gain: number; spread: number; top: number };
const DEFAULT_PUSH: SportPush = { gain: 40, spread: 55, top: 235 };
/** How hard each sports car pushes when it decides to race (km/h). */
export const SPORT_PUSH: Partial<Record<CarType, SportPush>> = {
  "bugatti-chiron": { gain: 60, spread: 80, top: 300 },
  "ferrari-sf90": { gain: 55, spread: 70, top: 290 },
};
/**
 * Sports-car mood: alternate calm cruising and pushes (sometimes repeating a
 * phase with a fresh speed and duration) so the rhythm never loops.
 */
export function nextSportMood(
  base: number,
  wasPush: boolean,
  r1: number,
  r2: number,
  r3: number,
  p: SportPush = DEFAULT_PUSH,
) {
  const push = wasPush ? r1 < 0.25 : r1 < 0.7;
  return push
    ? { push, cruise: Math.min(p.top, base + p.gain + r2 * p.spread), duration: 2.5 + r3 * 5 }
    : { push, cruise: base * (0.88 + r2 * 0.17), duration: 3.5 + r3 * 7.5 };
}
// Width/length in metres, matching the real-scale traffic models.
export const FOOTPRINTS: Record<CarType, [number, number]> = {
  m5: [1.8, 4.1],
  hatch: [1.8, 4.1],
  sedan: [1.85, 4.7],
  suv: [1.88, 4.65],
  pickup: [1.9, 5.3],
  bus: [2.55, 12],
  truck: [2.55, 19.8],
  "mustang-blue": [1.92, 4.8],
  "mustang-black": [1.92, 4.8],
  "bmw-m3": [1.9, 4.8],
  "porsche-gt3": [1.85, 4.57],
  "bugatti-chiron": [2.04, 4.54],
  "ferrari-sf90": [1.97, 4.71],
};
export function pickTrafficType(random: number, normalRandom: number, previous?: CarType): CarType {
  if (!isSportCar(previous)) {
    let edge = MUSTANG_CHANCE;
    if (random < edge) return normalRandom < 0.5 ? "mustang-blue" : "mustang-black";
    if (random < (edge += PORSCHE_CHANCE)) return "porsche-gt3";
    if (random < (edge += BMW_CHANCE)) return "bmw-m3";
    if (random < (edge += BUGATTI_CHANCE)) return "bugatti-chiron";
    if (random < (edge += FERRARI_CHANCE)) return "ferrari-sf90";
  }
  const regular: CarType[] = ["hatch", "sedan", "suv", "pickup", "bus", "truck"];
  return regular[Math.min(regular.length - 1, Math.floor(normalRandom * regular.length))] ?? "hatch";
}
export function trafficScreenY(base: number, z: number, playerZ: number, ppm: number) {
  return base - (z - playerZ) * ppm;
}
export function laneMotion(
  x: number,
  vx: number,
  heading: number,
  target: number,
  laneWidth: number,
  speed: number,
  ppm: number,
  dt: number,
) {
  const remaining = target - x;
  const limit = laneWidth * 0.55;
  const desired = Math.max(-limit, Math.min(limit, remaining * 1.7));
  const velocity = vx + (desired - vx) * (1 - Math.exp(-3.5 * dt));
  const next = x + velocity * dt;
  const arrived =
    Math.abs(target - next) < laneWidth * 0.008 && Math.abs(velocity) < laneWidth * 0.025;
  const angle = Math.atan2(velocity, Math.max(1, (speed / 3.6) * ppm));
  return {
    x: arrived ? target : next,
    vx: arrived ? 0 : velocity,
    rot: heading + (angle - heading) * (1 - Math.exp(-6 * dt)),
    arrived,
  };
}
