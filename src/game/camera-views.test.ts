import { describe, expect, it } from "vitest";
import {
  CAMERA_POSES,
  CAMERA_VIEWS,
  nextCameraView,
  type CameraView,
} from "./camera-views";

describe("camera views", () => {
  it("cycles through every view and wraps back to the chase cam", () => {
    let v: CameraView = CAMERA_VIEWS[0];
    const seen: CameraView[] = [v];
    for (let i = 0; i < CAMERA_VIEWS.length; i++) {
      v = nextCameraView(v);
      seen.push(v);
    }
    expect(new Set(seen).size).toBe(CAMERA_VIEWS.length);
    expect(v).toBe("chase");
  });

  it("keeps a fixed pose for every non-chase view", () => {
    for (const v of CAMERA_VIEWS) {
      if (v === "chase") continue;
      expect(CAMERA_POSES[v]).toBeDefined();
    }
  });

  it("mirrors the side cameras around the car", () => {
    expect(CAMERA_POSES.left.pos.dx).toBeLessThan(0);
    expect(CAMERA_POSES.right.pos.dx).toBeGreaterThan(0);
    expect(CAMERA_POSES.left.pos.dx).toBeCloseTo(-CAMERA_POSES.right.pos.dx, 6);
    expect(CAMERA_POSES.left.pos.y).toBeCloseTo(CAMERA_POSES.right.pos.y, 6);
  });

  it("places the reverse camera ahead of the car looking behind it", () => {
    // The car drives toward -z: ahead is negative, behind is positive.
    expect(CAMERA_POSES.reverse.pos.z).toBeLessThan(-4);
    expect(CAMERA_POSES.reverse.look.z).toBeGreaterThan(10);
  });

  it("puts the hood camera low over the front of the car", () => {
    expect(CAMERA_POSES.hood.pos.y).toBeLessThan(1.3);
    expect(CAMERA_POSES.hood.pos.z).toBeLessThan(-1);
    expect(CAMERA_POSES.hood.look.z).toBeLessThan(CAMERA_POSES.hood.pos.z);
  });
});
