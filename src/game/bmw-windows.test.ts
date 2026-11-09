import { expect, it } from "vitest";
import * as THREE from "three";
import { blackOutBmwWindow } from "./bmw-windows";

it("makes the BMW window shell fully black and opaque without transmission", () => {
  const mat = new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.85, transmission: 0.8 });
  mat.name = "PaletteMaterial004";
  mat.map = new THREE.Texture();
  expect(blackOutBmwWindow(mat)).toBe(true);
  expect(mat.color.getHex()).toBe(0x000000);
  expect(mat.opacity).toBe(1);
  expect(mat.transparent).toBe(false);
  expect(mat.transmission).toBe(0);
  expect(mat.map).toBeNull();
  expect(mat.depthWrite).toBe(true);
  expect(mat.envMapIntensity).toBe(0);
  expect(mat.clearcoat).toBe(0);
});

it("does not black out the BMW white body or its headlamp lenses", () => {
  for (const name of ["PaletteMaterial001", "headlight_glass", "Material_718", "PaletteMaterial011"]) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xeeefec });
    mat.name = name;
    expect(blackOutBmwWindow(mat)).toBe(false);
    expect(mat.color.getHex()).toBe(0xeeefec);
  }
});