// Scenery around the GP track (browser only): a grass valley that sits just
// under the track mesh, rising into wooded hills and mountains at the edges,
// so the circuit no longer floats in the sky.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { TrackCollision } from "./gp-track";

const STEP = 25; // metres between terrain vertices
const MARGIN = 1100; // metres of valley/hills beyond the track bounds
const UNDER = 0.6; // terrain sits this far under the track surface
const MAX_TREES = 2400;

export type Terrain = {
  group: THREE.Group;
  /** Terrain height at (x,z) (bilinear, metres). */
  heightAt: (x: number, z: number) => number;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function grassTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#5d7a3a";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const l = 30 + Math.random() * 30;
    g.fillStyle = `hsla(${80 + Math.random() * 30}, ${30 + Math.random() * 25}%, ${l}%, 0.45)`;
    g.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function buildTerrain(track: TrackCollision): Terrain {
  const x0 = track.minX - MARGIN;
  const z0 = track.minZ - MARGIN;
  const cols = Math.ceil((track.maxX + MARGIN - x0) / STEP) + 1;
  const rows = Math.ceil((track.maxZ + MARGIN - z0) / STEP) + 1;
  const n = cols * rows;
  const h = new Float32Array(n);
  const known = new Uint8Array(n);
  let sum = 0;
  let count = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * STEP;
      const z = z0 + r * STEP;
      // lowest track point around the vertex, so no terrain pokes through
      let lo = Infinity;
      for (const [dx, dz] of [[0, 0], [-8, -8], [8, -8], [-8, 8], [8, 8]] as const) {
        const y = track.lowestAt(x + dx, z + dz);
        if (!Number.isNaN(y)) lo = Math.min(lo, y);
      }
      if (lo !== Infinity) {
        const i = r * cols + c;
        h[i] = lo - UNDER;
        known[i] = 1;
        sum += lo;
        count++;
      }
    }
  const mean = count ? sum / count - UNDER : 0;
  for (let i = 0; i < n; i++) if (!known[i]) h[i] = mean;

  // Fill the gaps smoothly from the track heights (Jacobi relaxation, coarse to fine).
  const tmp = new Float32Array(n);
  for (let it = 0; it < 260; it++) {
    const span = it < 80 ? 8 : it < 160 ? 3 : 1;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (known[i]) {
          tmp[i] = h[i]!;
          continue;
        }
        const l = h[r * cols + Math.max(0, c - span)]!;
        const rr = h[r * cols + Math.min(cols - 1, c + span)]!;
        const u = h[Math.max(0, r - span) * cols + c]!;
        const d = h[Math.min(rows - 1, r + span) * cols + c]!;
        tmp[i] = (l + rr + u + d) / 4;
      }
    h.set(tmp);
  }

  // Distance to the track (two-pass chamfer), in metres.
  const dist = new Float32Array(n).fill(1e9);
  for (let i = 0; i < n; i++) if (known[i]) dist[i] = 0;
  const D = STEP;
  const DD = STEP * Math.SQRT2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c > 0) dist[i] = Math.min(dist[i]!, dist[i - 1]! + D);
      if (r > 0) {
        dist[i] = Math.min(dist[i]!, dist[i - cols]! + D);
        if (c > 0) dist[i] = Math.min(dist[i]!, dist[i - cols - 1]! + DD);
        if (c < cols - 1) dist[i] = Math.min(dist[i]!, dist[i - cols + 1]! + DD);
      }
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (c < cols - 1) dist[i] = Math.min(dist[i]!, dist[i + 1]! + D);
      if (r < rows - 1) {
        dist[i] = Math.min(dist[i]!, dist[i + cols]! + D);
        if (c < cols - 1) dist[i] = Math.min(dist[i]!, dist[i + cols + 1]! + DD);
        if (c > 0) dist[i] = Math.min(dist[i]!, dist[i + cols - 1]! + DD);
      }
    }

  // Rolling hills away from the circuit, mountains along the outer edge.
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (known[i]) continue;
      const x = x0 + c * STEP;
      const z = z0 + r * STEP;
      const roll =
        Math.sin(x * 0.0021 + 1.3) * Math.cos(z * 0.0027 - 0.4) * 0.6 +
        Math.sin(x * 0.0057 - z * 0.0043) * 0.3 +
        Math.sin(x * 0.013 + z * 0.011) * 0.1;
      const hills = smooth(60, 700, dist[i]!) * (35 + 55 * (roll + 0.5));
      const edge = Math.min(c, r, cols - 1 - c, rows - 1 - r) * STEP;
      const mountains = smooth(MARGIN * 0.75, MARGIN * 0.15, edge) * (180 + 160 * (roll + 0.5));
      h[i] = h[i]! + Math.max(0, hills) + mountains;
    }

  const heightAt = (x: number, z: number) => {
    const fc = Math.max(0, Math.min(cols - 1.001, (x - x0) / STEP));
    const fr = Math.max(0, Math.min(rows - 1.001, (z - z0) / STEP));
    const c = Math.floor(fc);
    const r = Math.floor(fr);
    const tx = fc - c;
    const tz = fr - r;
    const a = h[r * cols + c]!;
    const b = h[r * cols + c + 1]!;
    const d = h[(r + 1) * cols + c]!;
    const e = h[(r + 1) * cols + c + 1]!;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz;
  };

  // --- terrain mesh
  const geo = new THREE.PlaneGeometry((cols - 1) * STEP, (rows - 1) * STEP, cols - 1, rows - 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x0 + ((cols - 1) * STEP) / 2, 0, z0 + ((rows - 1) * STEP) / 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x8fae62);
  const dry = new THREE.Color(0xb3ab76);
  const rock = new THREE.Color(0x8d8a84);
  const snow = new THREE.Color(0xf1f3f5);
  const tint = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const c = Math.round((x - x0) / STEP);
    const r = Math.round((z - z0) / STEP);
    const k = r * cols + c;
    const y = h[k] ?? 0;
    pos.setY(i, y);
    const rise = y - mean;
    tint.copy(grass).lerp(dry, hash(c, r) * 0.35);
    tint.lerp(rock, smooth(150, 300, rise));
    tint.lerp(snow, smooth(330, 420, rise));
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 9, pos.getZ(i) / 9);
  const groundMat = new THREE.MeshLambertMaterial({
    map: grassTexture(),
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: 3,
    polygonOffsetUnits: 3,
  });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.name = "gp-terrain";
  ground.receiveShadow = false;

  // --- trees: one instanced draw (pine + broadleaf mix via vertex colours)
  const pine = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.25, 0.35, 2.2, 5).translate(0, 1.1, 0), 0x5a3d24),
    colored(new THREE.ConeGeometry(2.2, 5.5, 7).translate(0, 4.2, 0), 0x2f5a2a),
    colored(new THREE.ConeGeometry(1.6, 4, 7).translate(0, 6.6, 0), 0x386b31),
  ])!;
  const leafy = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.3, 0.4, 3, 5).translate(0, 1.5, 0), 0x5e4630),
    colored(new THREE.IcosahedronGeometry(2.8, 0).translate(0, 5, 0), 0x4c7a34),
  ])!;
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const spots: { x: number; z: number; s: number; rot: number; kind: number }[] = [];
  for (let r = 1; r < rows - 1; r++)
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const d = dist[i]!;
      if (known[i] || d < 40 || d > 900) continue;
      // woods hug the circuit, thinning out towards the hills
      const density = d < 250 ? 0.3 : d < 500 ? 0.12 : 0.05;
      if (hash(c * 1.7, r * 2.3) > density) continue;
      const rise = h[i]! - mean;
      if (rise > 240) continue;
      const x = x0 + (c + hash(c, r) - 0.5) * STEP;
      const z = z0 + (r + hash(c, r + 1) - 0.5) * STEP;
      // keep clear of any track part (service roads, run-offs)
      if (!Number.isNaN(track.lowestAt(x, z))) continue;
      spots.push({ x, z, s: 0.8 + hash(x, z) * 0.9, rot: hash(z, x) * 6.28, kind: hash(x + 3, z) > 0.45 ? 0 : 1 });
    }
  // Phone budget: at most MAX_TREES instances.
  while (spots.length > MAX_TREES) spots.splice(Math.floor(hash(spots.length, 7) * spots.length), 1);
  const group = new THREE.Group();
  group.name = "gp-scenery";
  group.add(ground);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [kind, g] of [pine, leafy].entries()) {
    const list = spots.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(g, treeMat, list.length);
    list.forEach((s, i) => {
      q.setFromAxisAngle(up, s.rot);
      m4.compose(
        new THREE.Vector3(s.x, heightAt(s.x, s.z) - 0.3, s.z),
        q,
        new THREE.Vector3(s.s, s.s * (0.9 + hash(s.z, s.x) * 0.4), s.s),
      );
      inst.setMatrixAt(i, m4);
    });
    inst.computeBoundingSphere();
    inst.name = kind ? "gp-trees-leafy" : "gp-trees-pine";
    group.add(inst);
  }
  return { group, heightAt };
}

function colored(geo: THREE.BufferGeometry, hex: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute("uv");
  const c = new THREE.Color(hex);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = 0.85 + ((i * 7919) % 30) / 100;
    arr[i * 3] = c.r * k;
    arr[i * 3 + 1] = c.g * k;
    arr[i * 3 + 2] = c.b * k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}
