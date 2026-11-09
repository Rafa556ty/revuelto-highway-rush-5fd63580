import { describe, expect, it } from "vitest";
import { detectUi, resolveUi, shadowOffset } from "./device-ui";

describe("device layout", () => {
  it("phones get touch controls", () => {
    expect(detectUi({ touchPoints: 5, coarse: true, width: 400 })).toBe("touch");
  });
  it("computers with mouse get the PC layout", () => {
    expect(detectUi({ touchPoints: 0, coarse: false, width: 1920 })).toBe("pc");
  });
  it("manual choice overrides detection", () => {
    expect(resolveUi("touch", "pc")).toBe("touch");
    expect(resolveUi("pc", "touch")).toBe("pc");
    expect(resolveUi("auto", "touch")).toBe("touch");
  });
});

describe("moving car shadow", () => {
  it("shifts sideways as the road goes on", () => {
    const xs = [0, 500, 1000, 1500, 2000].map((z) => shadowOffset(z, false, 0).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.3);
  });
  it("sweeps front to back under tunnel lamps", () => {
    expect(shadowOffset(2, true, 0).z).toBeLessThan(shadowOffset(22, true, 0).z);
  });
  it("fades at night", () => {
    expect(shadowOffset(100, false, 1).strength).toBeLessThan(shadowOffset(100, false, 0).strength);
  });
});
