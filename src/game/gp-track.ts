// GP track collision (pure TypeScript, no three.js / React).
// Built once from the track's world-space triangles: floor triangles answer
// "how high is the ground here and what surface is it", steep triangles are
// walls the car scrapes along.

export type Surface = "road" | "grass" | "gravel";

/** Colour of the ground texture → driving surface. Kerbs (red/white) count as road. */
export function classifyColor(r: number, g: number, b: number): Surface {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  if (sat < 0.2) return "road"; // asphalt, concrete, white lines
  if (g >= r && g > b * 1.08) return "grass";
  if (r > g && g > b && g > r * 0.6 && sat > 0.22) return "gravel"; // sand / dirt
  return "road"; // red kerbs, painted areas
}

export type TrackTexture = { w: number; h: number; data: Uint8ClampedArray };

export type TrackInput = {
  /** 9 floats per triangle: x,y,z of its three corners (world metres). */
  positions: Float32Array;
  /** 6 floats per triangle: u,v of its three corners (unused when tex = -1). */
  uvs?: Float32Array;
  /** 9 floats per triangle: vertex colour r,g,b 0..1 (used when tex = -1). */
  colors?: Float32Array;
  /** Texture index per triangle, -1 = vertex colour / unknown. */
  triTex?: Int16Array;
  textures?: TrackTexture[];
};

export type GroundHit = { y: number; surface: Surface; tri: number };
export type WallHit = { x: number; z: number; nx: number; nz: number; depth: number };

const CELL = 12;

export class TrackCollision {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  private cols: number;
  private rows: number;
  private floors: Map<number, number[]> = new Map();
  private walls: Map<number, number[]> = new Map();
  /** per wall: x1,z1,x2,z2,ymin,ymax */
  private wallData: number[] = [];
  private p: Float32Array;
  private input: TrackInput;

  constructor(input: TrackInput) {
    this.input = input;
    const p = input.positions;
    this.p = p;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i]!);
      maxX = Math.max(maxX, p[i]!);
      minZ = Math.min(minZ, p[i + 2]!);
      maxZ = Math.max(maxZ, p[i + 2]!);
    }
    this.minX = minX;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxZ = maxZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1);
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);

    const tris = p.length / 9;
    for (let t = 0; t < tris; t++) {
      const o = t * 9;
      const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!;
      const bx = p[o + 3]!, by = p[o + 4]!, bz = p[o + 5]!;
      const cx = p[o + 6]!, cy = p[o + 7]!, cz = p[o + 8]!;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      const tMinX = Math.min(ax, bx, cx), tMaxX = Math.max(ax, bx, cx);
      const tMinZ = Math.min(az, bz, cz), tMaxZ = Math.max(az, bz, cz);
      if (Math.abs(ny / len) >= 0.35) {
        this.bin(this.floors, tMinX, tMinZ, tMaxX, tMaxZ, t);
        continue;
      }
      const yMin = Math.min(ay, by, cy);
      const yMax = Math.max(ay, by, cy);
      if (yMax - yMin < 0.3) continue;
      // Wall footprint: the two corners furthest apart in plan view.
      const d1 = Math.hypot(ux, uz), d2 = Math.hypot(vx, vz), d3 = Math.hypot(cx - bx, cz - bz);
      let x1 = ax, z1 = az, x2 = bx, z2 = bz;
      if (d2 >= d1 && d2 >= d3) (x2 = cx), (z2 = cz);
      else if (d3 >= d1 && d3 >= d2) (x1 = bx), (z1 = bz), (x2 = cx), (z2 = cz);
      if (Math.hypot(x2 - x1, z2 - z1) < 0.05) continue;
      const w = this.wallData.length / 6;
      this.wallData.push(x1, z1, x2, z2, yMin, yMax);
      this.bin(this.walls, tMinX - 0.01, tMinZ - 0.01, tMaxX + 0.01, tMaxZ + 0.01, w);
    }
  }

  private key(cx: number, cz: number) {
    return cz * this.cols + cx;
  }

  private bin(map: Map<number, number[]>, x0: number, z0: number, x1: number, z1: number, id: number) {
    const c0 = Math.max(0, Math.floor((x0 - this.minX) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.minX) / CELL));
    const r0 = Math.max(0, Math.floor((z0 - this.minZ) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((z1 - this.minZ) / CELL));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const k = this.key(c, r);
        let list = map.get(k);
        if (!list) map.set(k, (list = []));
        list.push(id);
      }
  }

  private cell(map: Map<number, number[]>, x: number, z: number) {
    const c = Math.floor((x - this.minX) / CELL);
    const r = Math.floor((z - this.minZ) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return undefined;
    return map.get(this.key(c, r));
  }

  /** Height of triangle t at (x,z), or NaN when the point is outside it. */
  private heightOn(t: number, x: number, z: number, bary?: number[]) {
    const p = this.p;
    const o = t * 9;
    const ax = p[o]!, az = p[o + 2]!;
    const bx = p[o + 3]!, bz = p[o + 5]!;
    const cx = p[o + 6]!, cz = p[o + 8]!;
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) return NaN;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const l3 = 1 - l1 - l2;
    const e = -1e-4;
    if (l1 < e || l2 < e || l3 < e) return NaN;
    if (bary) (bary[0] = l1), (bary[1] = l2), (bary[2] = l3);
    return l1 * p[o + 1]! + l2 * p[o + 4]! + l3 * p[o + 7]!;
  }

  /**
   * Highest track surface at (x,z) that is no more than `step` above yRef
   * (so the car drives under bridges and roofs). null when off the track mesh.
   */
  groundAt(x: number, z: number, yRef: number, step = 0.9): GroundHit | null {
    const list = this.cell(this.floors, x, z);
    if (!list) return null;
    let best = -Infinity;
    let bestT = -1;
    const bary = [0, 0, 0];
    let keep = [0, 0, 0];
    for (const t of list) {
      const y = this.heightOn(t, x, z, bary);
      if (Number.isNaN(y) || y > yRef + step || y <= best) continue;
      best = y;
      bestT = t;
      keep = [bary[0]!, bary[1]!, bary[2]!];
    }
    if (bestT < 0) return null;
    return { y: best, tri: bestT, surface: this.surfaceOf(bestT, keep) };
  }

  /** Lowest track surface at (x,z) (to keep scenery underneath), or NaN. */
  lowestAt(x: number, z: number): number {
    const list = this.cell(this.floors, x, z);
    if (!list) return NaN;
    let lo = Infinity;
    for (const t of list) {
      const y = this.heightOn(t, x, z);
      if (!Number.isNaN(y) && y < lo) lo = y;
    }
    return lo === Infinity ? NaN : lo;
  }

  private surfaceOf(t: number, bary: number[]): Surface {
    const tex = this.input.triTex?.[t] ?? -1;
    if (tex >= 0) {
      const img = this.input.textures?.[tex];
      const uv = this.input.uvs;
      if (!img || !uv) return "road";
      const o = t * 6;
      const u = bary[0]! * uv[o]! + bary[1]! * uv[o + 2]! + bary[2]! * uv[o + 4]!;
      const v = bary[0]! * uv[o + 1]! + bary[1]! * uv[o + 3]! + bary[2]! * uv[o + 5]!;
      const px = Math.min(img.w - 1, Math.floor((u - Math.floor(u)) * img.w));
      const py = Math.min(img.h - 1, Math.floor((v - Math.floor(v)) * img.h));
      const i = (py * img.w + px) * 4;
      return classifyColor(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!);
    }
    const c = this.input.colors;
    if (!c) return "road";
    const o = t * 9;
    const r = bary[0]! * c[o]! + bary[1]! * c[o + 3]! + bary[2]! * c[o + 6]!;
    const g = bary[0]! * c[o + 1]! + bary[1]! * c[o + 4]! + bary[2]! * c[o + 7]!;
    const b = bary[0]! * c[o + 2]! + bary[1]! * c[o + 5]! + bary[2]! * c[o + 8]!;
    return classifyColor(r * 255, g * 255, b * 255);
  }

  /**
   * Push a circle (radius r, standing on y) out of every wall it overlaps.
   * Returns the deepest contact, or null when it touches nothing.
   */
  collide(x: number, z: number, y: number, r: number): WallHit | null {
    const seen = new Set<number>();
    let hit: WallHit | null = null;
    let px = x;
    let pz = z;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.cell(this.walls, x + dx * r, z + dz * r);
        if (!list) continue;
        for (const w of list) {
          if (seen.has(w)) continue;
          seen.add(w);
          const o = w * 6;
          const yMin = this.wallData[o + 4]!;
          const yMax = this.wallData[o + 5]!;
          if (yMax < y + 0.35 || yMin > y + 1.2) continue;
          const x1 = this.wallData[o]!, z1 = this.wallData[o + 1]!;
          const x2 = this.wallData[o + 2]!, z2 = this.wallData[o + 3]!;
          const ex = x2 - x1, ez = z2 - z1;
          const l2 = ex * ex + ez * ez;
          const k = Math.max(0, Math.min(1, ((px - x1) * ex + (pz - z1) * ez) / l2));
          const qx = x1 + ex * k, qz = z1 + ez * k;
          let nx = px - qx, nz = pz - qz;
          const d = Math.hypot(nx, nz);
          if (d >= r) continue;
          if (d > 1e-6) (nx /= d), (nz /= d);
          else {
            const el = Math.sqrt(l2);
            (nx = -ez / el), (nz = ex / el);
          }
          const depth = r - d;
          px += nx * depth;
          pz += nz * depth;
          if (!hit || depth > hit.depth) hit = { x: px, z: pz, nx, nz, depth };
        }
      }
    if (hit) (hit.x = px), (hit.z = pz);
    return hit;
  }
}
