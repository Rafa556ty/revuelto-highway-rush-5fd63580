import { it, expect } from "vitest";
import * as THREE from "three";
import { isolateActiveWing } from "./active-wing";
it("extracts real aero triangles and removes them from the static body", () => {
  const group = new THREE.Group(),
    geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-0.5, 1, 2, 0.5, 1, 2, 0, 1, 2.4, -0.5, 0.5, 0, 0.5, 0.5, 0, 0, 0.5, 1],
      3,
    ),
  );
  const mat = new THREE.MeshStandardMaterial();
  mat.name = "Body";
  const body = new THREE.Mesh(geometry, mat);
  group.add(body);
  const wing = isolateActiveWing(group);
  expect(wing).not.toBeNull();
  expect(body.geometry.getAttribute("position").count).toBe(3);
  expect(wing?.children.length).toBe(1);
});
