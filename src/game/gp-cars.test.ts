import { describe, expect, it } from "vitest";
import { GP_CARS, canSelectGpCar, isGpModeOpen } from "./gp-cars";

describe("GP mode rules", () => {
  it("only the BMW M3 GTR is available", () => {
    expect(GP_CARS.filter((c) => c.available).map((c) => c.id)).toEqual(["bmw-m3-gtr"]);
    expect(canSelectGpCar("bmw-m3-gtr")).toBe(true);
    expect(canSelectGpCar("revuelto")).toBe(false);
  });

  it("offline practice is open and the online championship is locked", () => {
    expect(isGpModeOpen("practice")).toBe(true);
    expect(isGpModeOpen("championship")).toBe(false);
  });
});
