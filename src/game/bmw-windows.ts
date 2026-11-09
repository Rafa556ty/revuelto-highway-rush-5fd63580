import * as THREE from "three";

/** Exporter name for the BMW's window shell, not its headlamp lenses. */
export function blackOutBmwWindow(mat: THREE.Material): boolean {
  const name = mat.name.toLowerCase();
  if (name !== "palettematerial004" && !/window|windshield|windscreen/.test(name)) return false;
  if (!(mat instanceof THREE.MeshStandardMaterial)) return false;
  mat.color.setHex(0x000000);
  mat.map = null;
  mat.alphaMap = null;
  mat.transparent = false;
  mat.opacity = 1;
  mat.depthWrite = true;
  mat.metalness = 0;
  mat.roughness = 0.8;
  mat.envMapIntensity = 0;
  if (mat instanceof THREE.MeshPhysicalMaterial) {
    mat.transmission = 0;
    mat.clearcoat = 0;
    mat.clearcoatRoughness = 0.08;
  }
  mat.needsUpdate = true;
  return true;
}