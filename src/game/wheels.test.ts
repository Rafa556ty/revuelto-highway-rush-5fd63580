import { describe, expect, it } from "vitest";
import { wheelOmega } from "./wheels";

describe("wheelOmega", () => {
  it("spins with road speed: 100 km/h on a 0.34 m tyre", () => {
    expect(wheelOmega(100, false, 0.34)).toBeCloseTo(100 / 3.6 / 0.34, 5);
  });

  it("locks the wheel abruptly when braking, even at high speed", () => {
    expect(wheelOmega(200, true, 0.34)).toBe(0);
  });

  it("is zero when the car is stopped", () => {
    expect(wheelOmega(0, false, 0.34)).toBe(0);
  });

  it("never divides by a tiny radius", () => {
    expect(wheelOmega(100, false, 0)).toBeCloseTo(100 / 3.6 / 0.05, 5);
  });
});
