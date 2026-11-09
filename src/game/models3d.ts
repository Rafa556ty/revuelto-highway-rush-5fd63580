// Loading + normalising the car GLBs (browser only; import dynamically).
// Every car comes out facing -Z (forward), centred on X/Z, wheels on y = 0,
// scaled so its length matches the real car in metres.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { normalizeCar } from "./normalize-car";
import { isolateActiveWing } from "./active-wing";
import { blackOutBmwWindow } from "./bmw-windows";
export { normalizeCar } from "./normalize-car";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Same detailed model the garage shows, so the race car looks identical.
import revueltoAsset from "@/assets/models/revuelto.glb.asset.json";
import mustangAsset from "@/assets/models/mustang-gt-traffic.glb.asset.json";
import bmwAsset from "@/assets/models/bmw-m4-traffic.glb.asset.json";

export type TrafficModelKey = "hatch" | "sedan" | "suv" | "pickup" | "bus" | "truck";
export type ModelKey =
  | "revuelto"
  | "mustang"
  | "bmw"
  | "porsche"
  | "bugatti"
  | "ferrari"
  | TrafficModelKey;

type ModelSpec = {
  url: string;
  length: number;
  /** extra yaw (radians) when the file's nose isn't detected */ yaw: number;
};

// Realistic CC0 traffic (tevy.dev), textures stripped + meshopt for phones.
// Their noses point +Z, so they are turned around explicitly.
export const MODEL_SPECS: Record<ModelKey, ModelSpec> = {
  revuelto: { url: revueltoAsset.url, length: 4.95, yaw: 0 },
  mustang: { url: mustangAsset.url, length: 4.8, yaw: 0 },
  bmw: { url: bmwAsset.url, length: 4.8, yaw: 0 },
  // User-supplied models, simplified + meshopt for traffic; both noses point +Z.
  porsche: { url: "/game-assets/porsche-gt3-traffic.glb", length: 4.57, yaw: Math.PI },
  bugatti: { url: "/game-assets/bugatti-chiron-traffic.glb", length: 4.54, yaw: Math.PI },
  ferrari: { url: "/game-assets/ferrari-sf90-traffic.glb", length: 4.71, yaw: Math.PI },
  hatch: { url: "/game-assets/traffic-hatch.glb", length: 4.1, yaw: Math.PI },
  sedan: { url: "/game-assets/traffic-sedan.glb", length: 4.7, yaw: Math.PI },
  suv: { url: "/game-assets/traffic-suv.glb", length: 4.65, yaw: Math.PI },
  pickup: { url: "/game-assets/traffic-pickup.glb", length: 5.3, yaw: Math.PI },
  bus: { url: "/game-assets/traffic-bus.glb", length: 12, yaw: Math.PI },
  truck: { url: "/game-assets/traffic-truck.glb", length: 19.8, yaw: Math.PI },
};

/** Real-world factory paint per traffic model. */
const TRAFFIC_PAINT: Record<TrafficModelKey, number> = {
  hatch: 0x8a1414, // solid red
  sedan: 0x4a5a6c, // grey-blue metallic
  suv: 0xd8dadd, // pearl silver
  pickup: 0xf1f1ee, // fleet white
  bus: 0xf2f2f0, // city white
  truck: 0x1d3f7a, // deep blue tractor
};

/**
 * Collapse the many small source materials into a few shared PBR finishes:
 * realistic look, and ~7 draws per vehicle type on the Galaxy A11.
 */
function styleTraffic(root: THREE.Object3D, key: TrafficModelKey) {
  const make = (p: THREE.MeshStandardMaterialParameters, name: string) => {
    const m = new THREE.MeshStandardMaterial(p);
    m.name = name;
    return m;
  };
  const mats = {
    paint: make({ color: TRAFFIC_PAINT[key], metalness: 0.55, roughness: 0.28 }, "paint"),
    roof: make({ color: 0xf4f4f2, metalness: 0.3, roughness: 0.4 }, "roof"),
    glass: make({ color: 0x0b1116, metalness: 0.9, roughness: 0.06 }, "glass"),
    trim: make({ color: 0x141518, metalness: 0.2, roughness: 0.62 }, "trim"),
    chrome: make({ color: 0xc9ced3, metalness: 1, roughness: 0.16 }, "chrome"),
    rubber: make({ color: 0x101012, metalness: 0, roughness: 0.92 }, "tire"),
    head: make(
      { color: 0xf4f6ff, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.2 },
      "light_front",
    ),
    tail: make(
      { color: 0x5a0303, emissive: 0xff1006, emissiveIntensity: 1.8, roughness: 0.25 },
      "light_rear",
    ),
    amber: make(
      { color: 0x7a4200, emissive: 0xff9000, emissiveIntensity: 1.2, roughness: 0.25 },
      "lamp_amber",
    ),
  };
  const pick = (name: string, old: THREE.Material): THREE.Material => {
    const n = name.toLowerCase();
    if (n.startsWith("roof_paint")) return mats.roof;
    if (n.startsWith("paint")) return mats.paint;
    if (n.includes("glass") || n.includes("screen") || n === "mirror") return mats.glass;
    if (n.startsWith("light_front")) return mats.head;
    if (n.startsWith("lamp_red") || n.startsWith("light_rear") || n === "red") return mats.tail;
    if (n.startsWith("lamp_amber") || n === "beacon") return mats.amber;
    if (n === "tire" || n === "tyre") return mats.rubber;
    if (n.includes("machined") || n === "chrome" || n === "rim" || n === "pole") return mats.chrome;
    if (n === "lamp") return mats.head;
    // Semi body keeps its own tones (blue tractor, white trailer), finer finish.
    if (n.startsWith("semi-truck_body")) {
      const std = old as THREE.MeshStandardMaterial;
      std.map = null;
      std.metalness = 0.5;
      std.roughness = 0.3;
      return std;
    }
    return mats.trim;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (key === "truck" && /trailer_mesh|door_rear/.test(o.name + (o.parent?.name ?? ""))) {
      m.material = trailerMaterial(m.geometry);
      return;
    }
    m.material = Array.isArray(m.material)
      ? m.material.map((x) => pick(x.name, x))
      : pick(m.material.name, m.material);
  });
}

let trailerMat: THREE.MeshStandardMaterial | null = null;
/**
 * Semi-trailer livery: corrugated aluminium box with a freight company graphic.
 * The source file has no UVs, so the box gets a side projection (u = length, v = height).
 */
function trailerMaterial(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  const nrm = geo.getAttribute("normal");
  const sx = bb.max.x - bb.min.x || 1;
  const sy = bb.max.y - bb.min.y || 1;
  const sz = bb.max.z - bb.min.z || 1;
  for (let i = 0; i < pos.count; i++) {
    const u = sz > sx ? (pos.getZ(i) - bb.min.z) / sz : (pos.getX(i) - bb.min.x) / sx;
    // mirror the left flank so the lettering reads correctly on both sides
    uv[i * 2] = nrm && nrm.getX(i) < 0 ? 1 - u : u;
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / sy;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  if (trailerMat) return trailerMat;
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 256;
  const g = cv.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#e9ebec");
  grad.addColorStop(1, "#c9cdd0");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 256);
  // corrugated ribs
  for (let x = 0; x < 1024; x += 16) {
    g.fillStyle = "rgba(0,0,0,0.10)";
    g.fillRect(x, 0, 3, 256);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(x + 3, 0, 2, 256);
  }
  // rails, livery stripe and lettering
  g.fillStyle = "#5b6066";
  g.fillRect(0, 0, 1024, 10);
  g.fillRect(0, 244, 1024, 12);
  g.fillStyle = "#c8102e";
  g.fillRect(0, 168, 1024, 22);
  g.fillStyle = "#0a2a6b";
  g.fillRect(0, 192, 1024, 12);
  g.fillStyle = "#0a2a6b";
  g.font = "bold 74px Barlow, Arial, sans-serif";
  g.textBaseline = "middle";
  g.fillText("RODOLOG", 90, 100);
  g.fillStyle = "#c8102e";
  g.font = "600 30px Barlow, Arial, sans-serif";
  g.fillText("TRANSPORTES & LOGÍSTICA", 96, 146);
  g.fillText("TRANSPORTES & LOGÍSTICA", 610, 146);
  g.fillStyle = "#0a2a6b";
  g.font = "bold 74px Barlow, Arial, sans-serif";
  g.fillText("RODOLOG", 604, 100);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  trailerMat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.45, roughness: 0.38 });
  trailerMat.name = "trailer_livery";
  return trailerMat;
}

const TRAFFIC_KEYS = new Set<ModelKey>(["hatch", "sedan", "suv", "pickup", "bus", "truck"]);

/** Revuelto body paint: the user wants it black, nothing else changed. */
export const REVUELTO_PAINT = 0x060607;

const cache = new Map<ModelKey, Promise<THREE.Group>>();

function makeLoader() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export async function fetchGlb(
  url: string,
  onProgress?: (r: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body?.getReader();
  if (!reader) return res.arrayBuffer();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    got += value.length;
    if (total) onProgress?.(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  onProgress?.(1);
  return out.buffer;
}

export async function parseGlb(buffer: ArrayBuffer): Promise<THREE.Group> {
  const gltf = await makeLoader().parseAsync(buffer, "");
  return gltf.scene;
}

/** Paint the Revuelto's body material and supercar trims for realism. */
export function paintRevuelto(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat) continue;
      const std = mat as THREE.MeshStandardMaterial;
      const n = (mat.name || "").toLowerCase();
      if (mat.name === "Body" || n.includes("body") || n.includes("carpaint")) {
        // Nero Nemesis metallic black with sharp sunlight specular highlights
        std.color.setHex(0x07080a);
        std.metalness = 0.90;
        std.roughness = 0.16;
        std.map = null;
        std.needsUpdate = true;
      } else if (n === "taillight_glass") {
        // Clear red lens over the Y lights (smoked glass hid them at night)
        std.color.setHex(0x5a0604);
        std.metalness = 0.2;
        std.roughness = 0.1;
        std.transparent = true;
        std.opacity = 0.45;
        std.depthWrite = false;
        std.needsUpdate = true;
      } else if (n === "tail_light" || n === "taillight_rear") {
        // Y-shaped running lights: deep red, glow driven by the race renderer
        std.color.setHex(0x420202);
        std.emissive.setHex(0xff0a04);
        std.emissiveMap = null;
        std.emissiveIntensity = 0.6;
        std.needsUpdate = true;
      } else if (n.includes("glass") || n.includes("window") || n.includes("windshield")) {
        // Deep smoked supercar privacy glass matching reference garage viewer
        std.color.setHex(0x0a1218);
        std.metalness = 0.92;
        std.roughness = 0.08;
        std.transparent = true;
        std.opacity = 0.58;
        std.needsUpdate = true;
      } else if (n.includes("rim") || n.includes("wheel") || n.includes("alloy")) {
        // Machined dark gunmetal forged alloy rims
        std.color.setHex(0x15171a);
        std.metalness = 0.95;
        std.roughness = 0.16;
        std.needsUpdate = true;
      } else if (n.includes("carbon") || n.includes("diffuser") || n.includes("splitter")) {
        // Satin carbon fiber weave aero accents
        std.color.setHex(0x121316);
        std.metalness = 0.62;
        std.roughness = 0.32;
        std.needsUpdate = true;
      } else if (n.includes("caliper")) {
        // Lamborghini Giallo Auge racing yellow brake calipers
        std.color.setHex(0xf5a623);
        std.metalness = 0.85;
        std.roughness = 0.22;
        std.needsUpdate = true;
      } else if (n.includes("interior_color") || n.includes("seat")) {
        // Arancio Apodis orange sport bucket seats visible through glass
        std.color.setHex(0xd65510);
        std.roughness = 0.52;
        std.metalness = 0.08;
        std.needsUpdate = true;
      } else if (n.includes("interior_black") || n.includes("steering")) {
        // Dark Nero Ade alcantara cockpit
        std.color.setHex(0x131416);
        std.roughness = 0.85;
        std.metalness = 0.05;
        std.needsUpdate = true;
      } else if (n.includes("inside_headlight")) {
        std.color.setHex(0x08090b);
        std.metalness = 0.95;
        std.roughness = 0.12;
        std.needsUpdate = true;
      } else if (n === "tail_light_brake") {
        // Separate brake line material: kept distinct so it can toggle independently
        std.color.setHex(0x380000);
        std.emissive.setHex(0xff0600);
        std.emissiveIntensity = 0; // Off by default until braking
        std.needsUpdate = true;
      }
    }
  });
}

/** BMW M3 Competition look: Alpine White paint, carbon roof/mirrors kept black. */
function paintBmw(root: THREE.Object3D) {
  // A stray brake part hangs 0.7 m below the tyres and lifted the car off the road.
  const stray: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material) && m.material.name === "Material_774") stray.push(o);
  });
  for (const o of stray) o.removeFromParent();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const std = mat as THREE.MeshPhysicalMaterial;
      if (blackOutBmwWindow(mat)) continue;
      if (mat.name === "PaletteMaterial001") {
        std.map = null;
        std.color.setHex(0xeeefec);
        std.metalness = 0.15;
        std.roughness = 0.22;
        if ("clearcoat" in std) std.clearcoat = 1;
        std.needsUpdate = true;
      } else if (mat.name === "Material_698") {
        std.color.setHex(0x1a1b1e); // carbon roof, mirror caps, lip
        std.roughness = 0.35;
        std.needsUpdate = true;
      }
    }
  });
}

/** Static cars share one draw per compatible material, not one per tiny part. */
function batchCar(root: THREE.Group, keep?: (o: THREE.Mesh) => boolean): THREE.Group {
  root.updateMatrixWorld(true);
  const groups = new Map<
    string,
    { material: THREE.Material; geometries: THREE.BufferGeometry[] }
  >();
  const extras: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    const geo = o.geometry.clone();
    const material = o.material as THREE.MeshStandardMaterial;
    // Unused UV/tangent/color streams split otherwise identical materials.
    if (!material.normalMap) geo.deleteAttribute("tangent");
    if (!material.vertexColors) geo.deleteAttribute("color");
    if (!material.aoMap && !material.lightMap) geo.deleteAttribute("uv1");
    if (
      !material.map &&
      !material.normalMap &&
      !material.roughnessMap &&
      !material.metalnessMap &&
      !material.emissiveMap &&
      !material.alphaMap
    )
      geo.deleteAttribute("uv");
    // Meshopt may quantize the same attribute differently on separate parts.
    // Read normalized values before merging, so no car parts disappear.
    for (const [name, attribute] of Object.entries(geo.attributes)) {
      if (
        !(attribute instanceof THREE.BufferAttribute) &&
        !(attribute instanceof THREE.InterleavedBufferAttribute)
      )
        continue;
      const values = new Float32Array(attribute.count * attribute.itemSize);
      for (let i = 0; i < attribute.count; i++) {
        for (let component = 0; component < attribute.itemSize; component++) {
          values[i * attribute.itemSize + component] = attribute.getComponent(i, component);
        }
      }
      geo.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
    }
    // Decode quantized positions BEFORE baking transforms: writing a world
    // position back into Int16 attributes clips the body panels and wheels.
    geo.applyMatrix4(o.matrixWorld);
    if (keep?.(o)) {
      // The Revuelto GLB bakes all four wheels into ONE mesh per part
      // (tyre, rim, rotor, logo) centred on the car. Split each part into
      // the four corners so every wheel spins around its own hub.
      const pos = geo.getAttribute("position");
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const zMid = (bb.min.z + bb.max.z) / 2;
      const index = geo.getIndex();
      const triCount = (index ? index.count : pos.count) / 3;
      const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
      const buckets: number[][] = [[], [], [], []];
      for (let t = 0; t < triCount; t++) {
        const a = vi(t, 0);
        const b = vi(t, 1);
        const c = vi(t, 2);
        const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
        const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
        buckets[(cx < 0 ? 0 : 1) + (cz < zMid ? 0 : 2)]!.push(a, b, c);
      }
      for (const bucket of buckets) {
        if (!bucket.length) continue;
        const compact = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(geo.attributes)) {
          const a = attr as THREE.BufferAttribute;
          const out = new Float32Array(bucket.length * a.itemSize);
          for (let i = 0; i < bucket.length; i++) {
            for (let k = 0; k < a.itemSize; k++) {
              out[i * a.itemSize + k] = a.getComponent(bucket[i]!, k);
            }
          }
          compact.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
        }
        compact.computeBoundingBox();
        const wb = compact.boundingBox!;
        const center = wb.getCenter(new THREE.Vector3());
        compact.translate(-center.x, -center.y, -center.z);
        const mesh = new THREE.Mesh(compact, material);
        mesh.name = `${o.name}_${center.x < 0 ? "L" : "R"}${center.z < zMid ? "F" : "R"}`;
        mesh.position.copy(center);
        mesh.castShadow = true;
        mesh.userData["wheel"] = true;
        mesh.userData["radius"] = Math.max(0.2, (wb.max.y - wb.min.y) / 2);
        extras.push(mesh);
      }
      geo.dispose();
      return;
    }
    const expanded = geo.toNonIndexed();
    geo.dispose();
    const attributes = Object.keys(expanded.attributes).sort().join(",");
    const mat = o.material as THREE.MeshStandardMaterial;
    const key = JSON.stringify([
      mat.type,
      mat.color?.getHex(),
      mat.emissive?.getHex(),
      mat.emissiveIntensity,
      mat.metalness,
      mat.roughness,
      mat.map?.uuid,
      mat.normalMap?.uuid,
      mat.roughnessMap?.uuid,
      mat.metalnessMap?.uuid,
      mat.alphaMap?.uuid,
      mat.aoMap?.uuid,
      mat.emissiveMap?.uuid,
      mat.transparent,
      mat.opacity,
      mat.side,
      mat.alphaTest,
      mat.depthWrite,
      mat.vertexColors,
      attributes,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = { material: o.material, geometries: [] };
      groups.set(key, group);
    }
    group.geometries.push(expanded);
  });
  const result = new THREE.Group();
  for (const { material, geometries } of groups.values()) {
    const merged = mergeGeometries(geometries);
    if (merged) {
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = material.name;
      mesh.castShadow = true;
      result.add(mesh);
      for (const geometry of geometries) geometry.dispose();
    } else {
      // Merge refused (mismatched streams): keep each part, never drop it (lost tyres).
      for (const geometry of geometries) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = material.name;
        mesh.castShadow = true;
        result.add(mesh);
      }
    }
  }
  for (const e of extras) result.add(e);
  return result.children.length ? result : root;
}

/**
 * The Chiron's rear wing (materials prefixed "Wing_" by the optimiser) is
 * batched on its own and parented to an "active-wing" group whose origin is
 * the wing's leading bottom edge, so the renderer can raise and tilt it.
 */
function splitBugattiWing(grounded: THREE.Group): THREE.Group {
  grounded.updateMatrixWorld(true);
  const sources: THREE.Mesh[] = [];
  grounded.traverse((o) => {
    if (o instanceof THREE.Mesh && !Array.isArray(o.material) && o.material.name.startsWith("Wing_"))
      sources.push(o);
  });
  const loose = new THREE.Group();
  for (const o of sources) {
    const material = o.material as THREE.Material;
    const copy = new THREE.Mesh(o.geometry, material);
    copy.name = material.name;
    o.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    loose.add(copy);
    o.removeFromParent();
  }
  const body = batchCar(grounded);
  if (!sources.length) return body;
  const panel = batchCar(loose);
  const box = new THREE.Box3().setFromObject(panel);
  const pivot = new THREE.Vector3(0, box.min.y, box.min.z);
  const wing = new THREE.Group();
  wing.name = "active-wing";
  wing.position.copy(pivot);
  for (const child of [...panel.children]) {
    const mesh = child as THREE.Mesh;
    mesh.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
    // The black hydraulic block under the panel telescopes instead of tilting.
    mesh.userData["strut"] = /exhaust/i.test((mesh.material as THREE.Material).name);
    wing.add(mesh);
  }
  body.add(wing);
  return body;
}

/** Normalised, shared template for one car model (clone it per instance). */
export function loadCar(key: ModelKey): Promise<THREE.Group> {
  let p = cache.get(key);
  if (!p) {
    const spec = MODEL_SPECS[key];
    p = fetchGlb(spec.url)
      .then(parseGlb)
      .then((scene) => {
        if (key === "revuelto") paintRevuelto(scene);
        if (TRAFFIC_KEYS.has(key)) styleTraffic(scene, key as TrafficModelKey);
        if (key === "bmw") paintBmw(scene);
        if (key === "mustang") {
          scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
              if (mat && mat.name === "Body") {
                const std = mat as THREE.MeshStandardMaterial;
                std.metalness = 0.82;
                std.roughness = 0.18;
                std.needsUpdate = true;
              }
            }
          });
        }
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            const materials = Array.isArray(m.material) ? m.material : [m.material];
            for (const material of materials) {
              // Screen-space glass transmission redraws the entire world.
              // Reflective alpha glass retains windows without that extra pass.
              if (material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0) {
                material.transmission = 0;
                material.transparent = true;
                material.opacity = 0.48;
                material.depthWrite = false;
              }
              material.forceSinglePass = true;
            }
            m.castShadow = true;
            m.receiveShadow = false;
            m.frustumCulled = true;
          }
        });
        if (key === "bugatti") return splitBugattiWing(normalizeCar(scene, spec));
        // Revuelto wheels (tyre, rim, rotor, logo) stay unmerged so they can
        // spin; the caliper is bolted to the upright and does not turn.
        const result = batchCar(
          normalizeCar(scene, spec),
          key === "revuelto"
            ? (o) => o.name.startsWith("Wheel_") && !o.name.includes("Caliper")
            : undefined,
        );
        if (key === "revuelto") isolateActiveWing(result);
        return result;
      });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
