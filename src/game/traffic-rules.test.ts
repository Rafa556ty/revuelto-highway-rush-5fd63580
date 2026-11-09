import { describe, it, expect } from "vitest";
import {
  MUSTANG_CHANCE,
  pickTrafficType,
  trafficScreenY,
  laneMotion,
  TRAFFIC_KEEP_AHEAD,
  TRAFFIC_SPAWN_AHEAD,
  TRAFFIC_DRAW_AHEAD,
  FOOTPRINTS,
  SPORT_SLOT,
} from "./traffic-rules";
import { stepAero } from "./aero";
describe("requested traffic and aero rules", () => {
  it("keeps the sports slot 60 percent below the old Mustang probability", () =>
    expect(SPORT_SLOT).toBeCloseTo((2 / 3) * 0.4));
  it("never selects consecutive Mustangs", () =>
    expect(pickTrafficType(0, 0, "mustang-blue")).toBe("hatch"));
  it("selects a white-bus class and all ordinary vehicle types", () => {
    expect([0, 0.17, 0.34, 0.51, 0.68, 0.85].map((n) => pickTrafficType(0.99, n))).toEqual([
      "hatch",
      "sedan",
      "suv",
      "pickup",
      "bus",
      "truck",
    ]);
    expect(FOOTPRINTS.bus).toEqual([2.55, 12]);
    expect(FOOTPRINTS.truck).toEqual([2.55, 19.8]);
  });
  it("spawns in world position beyond the drawn horizon and retains distant traffic", () => {
    expect(trafficScreenY(500, 300, 10, 20)).toBe(-5300);
    expect(TRAFFIC_SPAWN_AHEAD).toBeGreaterThan(TRAFFIC_DRAW_AHEAD);
    expect(TRAFFIC_KEEP_AHEAD).toBeGreaterThan(TRAFFIC_SPAWN_AHEAD);
  });
  it("changes lanes gradually with heading matching lateral motion", () => {
    let s = { x: 0, vx: 0, rot: 0, arrived: false };
    s = laneMotion(s.x, s.vx, s.rot, 3.6, 3.6, 100, 1, 1 / 60);
    expect(s.x).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(0.01);
    expect(s.rot).toBeGreaterThan(0);
    for (let i = 0; i < 600; i++) s = laneMotion(s.x, s.vx, s.rot, 3.6, 3.6, 100, 1, 1 / 60);
    expect(s.x).toBeCloseTo(3.6);
    expect(s.rot).toBeCloseTo(0, 2);
  });
  it("raises the wing gradually in high speed", () => {
    const s = stepAero({ lift: 0, tilt: 0 }, 180, false, 0.05);
    expect(s.lift).toBeGreaterThan(0);
    expect(s.lift).toBeLessThan(0.1);
  });
  it("tilts the wing forward while braking", () =>
    expect(stepAero({ lift: 1, tilt: 0 }, 180, true, 0.05).tilt).toBeLessThan(0));
  it("retracts the wing when stopped", () =>
    expect(stepAero({ lift: 1, tilt: 0 }, 0, false, 5).lift).toBeLessThan(0.01));
});

import {
  BMW_CHANCE,
  PORSCHE_CHANCE,
  BUGATTI_CHANCE,
  SPORT_PUSH,
  nextSportMood,
  isSportCar,
} from "./traffic-rules";
import { stepTrafficWing } from "./aero";
describe("Porsche GT3 and Bugatti Chiron traffic", () => {
  it("Porsches replace some Mustangs, but not all", () => {
    expect(PORSCHE_CHANCE).toBeGreaterThan(0);
    expect(MUSTANG_CHANCE).toBeGreaterThan(0);
    expect(MUSTANG_CHANCE + PORSCHE_CHANCE).toBeCloseTo(SPORT_SLOT);
    expect(pickTrafficType(MUSTANG_CHANCE + PORSCHE_CHANCE / 2, 0)).toBe("porsche-gt3");
  });
  it("Bugatti is the rarest car on the road", () => {
    expect(BUGATTI_CHANCE).toBeGreaterThan(0);
    expect(BUGATTI_CHANCE).toBeLessThan(Math.min(BMW_CHANCE, PORSCHE_CHANCE, MUSTANG_CHANCE / 2));
    const edge = MUSTANG_CHANCE + PORSCHE_CHANCE + BMW_CHANCE;
    expect(pickTrafficType(edge + BUGATTI_CHANCE / 2, 0)).toBe("bugatti-chiron");
    expect(pickTrafficType(edge + BUGATTI_CHANCE / 2, 0, "porsche-gt3")).toBe("hatch");
  });
  it("both use the sports-car calm/push rhythm", () => {
    expect(isSportCar("porsche-gt3") && isSportCar("bugatti-chiron")).toBe(true);
    const push = nextSportMood(130, false, 0, 0.5, 0.5, SPORT_PUSH["bugatti-chiron"]);
    expect(push.push).toBe(true);
    expect(push.cruise).toBeGreaterThan(130 + 40);
  });
  it("Bugatti wing rises gradually while racing and stays low while cruising", () => {
    const first = stepTrafficWing(0, true, 0.05);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.1);
    let lift = 0;
    for (let i = 0; i < 200; i++) lift = stepTrafficWing(lift, true, 0.05);
    expect(lift).toBeGreaterThan(0.99);
    expect(stepTrafficWing(0, false, 1)).toBe(0);
    for (let i = 0; i < 200; i++) lift = stepTrafficWing(lift, false, 0.05);
    expect(lift).toBeLessThan(0.01);
  });
});
import { FERRARI_CHANCE } from "./traffic-rules";
describe("Ferrari SF90 traffic", () => {
  it("Ferrari is more frequent than the Bugatti but still a rare sports car", () => {
    expect(FERRARI_CHANCE).toBeGreaterThan(BUGATTI_CHANCE);
    expect(FERRARI_CHANCE).toBeLessThan(BMW_CHANCE);
    const edge = MUSTANG_CHANCE + PORSCHE_CHANCE + BMW_CHANCE + BUGATTI_CHANCE;
    expect(pickTrafficType(edge + FERRARI_CHANCE / 2, 0)).toBe("ferrari-sf90");
    expect(pickTrafficType(edge + FERRARI_CHANCE / 2, 0, "bugatti-chiron")).toBe("hatch");
  });
  it("uses the same calm/push rhythm and real SF90 size", () => {
    expect(isSportCar("ferrari-sf90")).toBe(true);
    expect(nextSportMood(130, false, 0, 0.5, 0.5, SPORT_PUSH["ferrari-sf90"]).push).toBe(true);
    expect(FOOTPRINTS["ferrari-sf90"]).toEqual([1.97, 4.71]);
  });
});
describe("BMW M3 and sports-car rhythm", () => {
  it("BMW is as rare as one colour of the old Mustang slot and never follows another sports car", () => {
    expect(BMW_CHANCE).toBeCloseTo(SPORT_SLOT / 2);
    expect(pickTrafficType(MUSTANG_CHANCE + PORSCHE_CHANCE + BMW_CHANCE / 2, 0)).toBe("bmw-m3");
    expect(pickTrafficType(MUSTANG_CHANCE + BMW_CHANCE / 2, 0, "bmw-m3")).toBe("hatch");
    expect(isSportCar("bmw-m3") && isSportCar("mustang-blue") && !isSportCar("sedan")).toBe(true);
  });
  it("pushes speed above base, calms near base", () => {
    const push = nextSportMood(120, false, 0, 0.5, 0.5);
    expect(push.push).toBe(true);
    expect(push.cruise).toBeGreaterThan(150);
    const calm = nextSportMood(120, true, 0.9, 0.5, 0.5);
    expect(calm.push).toBe(false);
    expect(calm.cruise).toBeLessThan(130);
  });
});
