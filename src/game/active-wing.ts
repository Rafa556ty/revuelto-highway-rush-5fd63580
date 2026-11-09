import * as THREE from "three";

/** Separate the upper rear aero panel from the original baked Body geometry. */
export function isolateActiveWing(root: THREE.Group): THREE.Group | null {
  const wing = new THREE.Group();
  wing.name = "active-wing";
  const pivot = new THREE.Vector3(0, 0.96, 2.12);
  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      Array.isArray(object.material) ||
      object.material.name !== "Body"
    )
      return;
    const source = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry;
    const position = source.getAttribute("position");
    const moving: number[] = [],
      fixed: number[] = [];
    for (let i = 0; i < position.count; i += 3) {
      let rearPanel = true;
      for (let j = 0; j < 3; j++)
        if (position.getZ(i + j) < 1.86 || position.getY(i + j) < 0.83) rearPanel = false;
      (rearPanel ? moving : fixed).push(i, i + 1, i + 2);
    }
    if (!moving.length) return;
    const subset = (indices: number[]) => {
      const geo = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(source.attributes)) {
        if (
          !(a instanceof THREE.BufferAttribute) &&
          !(a instanceof THREE.InterleavedBufferAttribute)
        )
          continue;
        const values = new Float32Array(indices.length * a.itemSize);
        indices.forEach((id, i) => {
          for (let c = 0; c < a.itemSize; c++) values[i * a.itemSize + c] = a.getComponent(id, c);
        });
        geo.setAttribute(name, new THREE.BufferAttribute(values, a.itemSize));
      }
      geo.computeBoundingSphere();
      return geo;
    };
    object.geometry = subset(fixed);
    const geo = subset(moving);
    geo.translate(-pivot.x, -pivot.y, -pivot.z);
    const mat = (object.material as THREE.Material).clone();
    mat.side = THREE.DoubleSide;
    const panel = new THREE.Mesh(geo, mat);
    panel.castShadow = true;
    wing.add(panel);
  });
  if (!wing.children.length) return null;
  wing.position.copy(pivot);
  root.add(wing);
  // Telescoping supports stay hidden under the panel when retracted.
  const metal = new THREE.MeshStandardMaterial({ color: 0x45494d, metalness: 0.8, roughness: 0.3 });
  for (const x of [-0.55, 0.55]) {
    const support = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 0.32, 8), metal);
    support.position.set(x, 0.8, 2.1);
    support.name = "wing-support";
    support.visible = false;
    root.add(support);
  }
  return wing;
}
