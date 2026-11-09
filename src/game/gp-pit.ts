// GP offline practice: drive the Grand Valley Speedway from the pit box
// (browser only; import dynamically). The track is the user-supplied GLB.
// One stepper per frame: physics → ground/walls → audio → camera → render.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { fetchGlb, parseGlb } from "./models3d";
import { normalizeCar } from "./normalize-car";
import { GP_CARS } from "./gp-cars";
import { CAMERA_POSES, type CameraView } from "./camera-views";
import { TrackCollision, type Surface, type TrackTexture } from "./gp-track";
import { buildTerrain } from "./gp-terrain";
import {
  G,
  bounceOffWall,
  forward,
  kmh,
  newDriveState,
  right,
  stepDrive,
  type DriveInput,
} from "./gp-drive";
import type { GameAudio } from "./audio";

export const TRACK_URL = "/game-assets/grand-valley-speedway.glb";

/** Pit box in front of the garages on the main straight (track units are metres). */
const PIT = { x: -110, z: -752, heading: Math.PI / 2 };
/** Car footprint for wall contacts: two circles on the axles. */
const AXLE = 1.25;
const BODY_R = 0.95;

const buffers = new Map<string, Promise<ArrayBuffer>>();
function load(url: string, onProgress?: (r: number) => void) {
  let p = buffers.get(url);
  if (!p) {
    p = fetchGlb(url, onProgress);
    p.catch(() => buffers.delete(url));
    buffers.set(url, p);
  } else onProgress?.(1);
  return p;
}

/** Download the track and every unlocked car once (loading screen). */
export async function preloadGp(onProgress: (r: number) => void) {
  const urls = [TRACK_URL, ...GP_CARS.flatMap((c) => (c.model ? [c.model.url] : []))];
  const parts = urls.map(() => 0);
  const report = () => onProgress(parts.reduce((a, b) => a + b, 0) / parts.length);
  await Promise.all(
    urls.map((u, i) =>
      load(u, (r) => {
        parts[i] = r;
        report();
      }),
    ),
  );
  onProgress(1);
}

function skyTexture() {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 512;
  const g = cv.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#2f6fb8");
  grad.addColorStop(0.32, "#6fa6dc");
  grad.addColorStop(0.47, "#cfdde8");
  grad.addColorStop(0.5, "#c9d6de");
  grad.addColorStop(1, "#c9d6de");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  // soft cumulus band above the horizon
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 1024;
    const y = 110 + Math.random() * 110;
    const r = 14 + Math.random() * 40;
    const c = g.createRadialGradient(x, y, 0, x, y, r);
    c.addColorStop(0, "rgba(255,255,255,0.55)");
    c.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(x, y, r * 2.2, r, 0, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

function pitBoxTexture() {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 512;
  const g = cv.getContext("2d")!;
  g.strokeStyle = "#f2c200";
  g.lineWidth = 14;
  g.strokeRect(10, 10, 236, 492);
  g.fillStyle = "#ffffff";
  g.font = "bold 64px Barlow, Arial, sans-serif";
  g.textAlign = "center";
  g.fillText("PIT", 128, 470);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** World-space triangles + texture pixels of the track for ground / wall queries. */
function buildCollision(track: THREE.Object3D) {
  track.updateMatrixWorld(true);
  const pos: number[] = [];
  const uvs: number[] = [];
  const cols: number[] = [];
  const triTex: number[] = [];
  const textures: TrackTexture[] = [];
  const texIndex = new Map<THREE.Texture, number>();
  const v = new THREE.Vector3();
  const readTexture = (map: THREE.Texture) => {
    const img = map.image as CanvasImageSource & { width: number; height: number };
    const w = Math.min(512, img.width || 512);
    const h = Math.min(512, img.height || 512);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d", { willReadFrequently: true });
    if (!g) return -1;
    try {
      g.drawImage(img, 0, 0, w, h);
      textures.push({ w, h, data: g.getImageData(0, 0, w, h).data });
    } catch {
      return -1;
    }
    return textures.length - 1;
  };
  track.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const p = g.getAttribute("position");
    const uv = g.getAttribute("uv");
    const col = g.getAttribute("color");
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshBasicMaterial;
    let ti = -1;
    if (mat?.map && uv) {
      ti = texIndex.get(mat.map) ?? readTexture(mat.map);
      texIndex.set(mat.map, ti);
    }
    const idx = g.getIndex();
    const count = idx ? idx.count : p.count;
    for (let i = 0; i < count; i++) {
      const k = idx ? idx.getX(i) : i;
      v.fromBufferAttribute(p, k).applyMatrix4(m.matrixWorld);
      pos.push(v.x, v.y, v.z);
      uvs.push(uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0);
      cols.push(col ? col.getX(k) : 0.5, col ? col.getY(k) : 0.5, col ? col.getZ(k) : 0.5);
      if (i % 3 === 0) triTex.push(ti);
    }
  });
  return new TrackCollision({
    positions: new Float32Array(pos),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(cols),
    triTex: new Int16Array(triTex),
    textures,
  });
}

export type GpHud = { speed: number; gear: number; distance: number; topSpeed: number; surface: Surface };
export type GpInput = DriveInput & { horn: boolean };

export type GpDriveHandle = {
  input: GpInput;
  setCamera: (view: CameraView) => void;
  setPaused: (paused: boolean) => void;
  resetToPit: () => void;
  dispose: () => void;
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export async function mountGpDrive(
  container: HTMLElement,
  model: { url: string; length: number; yaw: number },
  opts: { audio: GameAudio | null; onHud: (h: GpHud) => void },
): Promise<GpDriveHandle> {
  const [trackBuf, carBuf] = await Promise.all([load(TRACK_URL), load(model.url)]);
  const [track, carScene] = await Promise.all([
    parseGlb(trackBuf.slice(0)),
    parseGlb(carBuf.slice(0)),
  ]);

  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const sky = skyTexture();
  scene.background = sky;
  scene.fog = new THREE.Fog(0xc9d6de, 400, 3400);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a35, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -9;
  sun.shadow.camera.right = sun.shadow.camera.top = 9;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  track.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map) map.anisotropy = 8;
    }
  });
  scene.add(track);
  const col = buildCollision(track);
  const terrain = buildTerrain(col);
  scene.add(terrain.group);

  const ground = (x: number, z: number, yRef: number) => {
    const hit = col.groundAt(x, z, yRef);
    const t = terrain.heightAt(x, z);
    if (hit && hit.y >= t - 0.05) return { y: hit.y, surface: hit.surface };
    return { y: t, surface: "grass" as Surface };
  };

  // Pit box decal + tyre stacks stay where the car starts.
  const pitY = ground(PIT.x, PIT.z, 500).y;
  const pit = new THREE.Group();
  pit.position.set(PIT.x, pitY + 0.02, PIT.z);
  pit.rotation.y = PIT.heading;
  const box = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 6.4),
    new THREE.MeshBasicMaterial({ map: pitBoxTexture(), transparent: true, depthWrite: false }),
  );
  box.rotation.x = -Math.PI / 2;
  box.position.y = 0.01;
  pit.add(box);
  const tyreGeo = new THREE.TorusGeometry(0.28, 0.13, 10, 20);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.9 });
  for (const [x, z, n] of [
    [-2.4, -1.6, 4],
    [-2.4, 1.6, 3],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const t = new THREE.Mesh(tyreGeo, tyreMat);
      t.rotation.x = Math.PI / 2;
      t.position.set(x, 0.13 + i * 0.26, z);
      pit.add(t);
    }
  }
  scene.add(pit);

  // Player car
  const carModel = normalizeCar(carScene, model);
  carModel.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  const car = new THREE.Group();
  car.rotation.order = "YXZ";
  const body = new THREE.Group(); // dynamic pitch / roll on the suspension
  body.add(carModel);
  car.add(body);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.ShadowMaterial({ opacity: 0.42 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.receiveShadow = true;
  car.add(shadow);
  scene.add(car);

  const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 6000);
  scene.add(camera);

  // ---- state
  const input: GpInput = { left: false, right: false, gas: false, brake: false, horn: false };
  const s = newDriveState(PIT.heading);
  const p = { x: PIT.x, y: pitY, z: PIT.z, vy: 0 };
  let surface: Surface = "road";
  let pitch = 0;
  let roll = 0;
  let slope = 0;
  let bodyPitch = 0;
  let bodyRoll = 0;
  let lastVF = 0;
  let camView: CameraView = "chase";
  let camHeading = PIT.heading;
  let camY = pitY;
  let camPull = 0;
  let shake = 0;
  let paused = false;
  let distance = 0;
  let topSpeed = 0;
  let hornOn = false;
  let hudT = 0;

  const resetToPit = () => {
    Object.assign(s, newDriveState(PIT.heading));
    Object.assign(p, { x: PIT.x, y: pitY, z: PIT.z, vy: 0 });
    camHeading = PIT.heading;
    camY = pitY;
  };

  const aspectFov = () => (camera.aspect < 1 ? 1.18 : 1);
  const observer = new ResizeObserver(() => {
    const cw = Math.max(1, container.clientWidth);
    const ch = Math.max(1, container.clientHeight);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    renderer.setSize(cw, ch);
  });
  observer.observe(container);

  const audio = opts.audio;
  audio?.rev();

  const step = (dt: number) => {
    const spd = Math.abs(s.vF);
    const n = Math.min(10, Math.max(1, Math.ceil((spd * dt) / 0.35)));
    const hdt = dt / n;
    for (let i = 0; i < n; i++) {
      const shifted = stepDrive(s, input, surface, slope, hdt);
      if (shifted && s.gear % 2 === 0) audio?.fireExhaustBackfire();
      const f = forward(s.heading);
      const r = right(s.heading);
      p.x += (f.x * s.vF + r.x * s.vL) * hdt;
      p.z += (f.z * s.vF + r.z * s.vL) * hdt;
      // Walls: front and rear axle circles.
      for (const sign of [1, -1]) {
        const cx = p.x + f.x * AXLE * sign;
        const cz = p.z + f.z * AXLE * sign;
        const hit = col.collide(cx, cz, p.y, BODY_R);
        if (!hit) continue;
        p.x += hit.x - cx;
        p.z += hit.z - cz;
        const impact = bounceOffWall(s, hit.nx, hit.nz);
        if (impact > 0) {
          shake = Math.max(shake, Math.min(4, impact * 0.25));
          if (impact > 14) audio?.crash();
          // the body swings to follow the wall a little
          const along = Math.atan2(-(hit.nz), hit.nx);
          void along;
          s.heading += (sign * s.vL * 0.01);
        }
      }
      distance += Math.abs(s.vF) * hdt;
    }

    // Ground: height, surface, slope and body attitude.
    const g = ground(p.x, p.z, p.y);
    surface = g.surface;
    if (p.y > g.y + 0.3) {
      p.vy -= G * dt;
      p.y += p.vy * dt;
      if (p.y <= g.y) (p.y = g.y), (p.vy = 0);
    } else {
      p.y = g.y;
      p.vy = 0;
    }
    const f = forward(s.heading);
    const r = right(s.heading);
    const yF = ground(p.x + f.x * 1.4, p.z + f.z * 1.4, p.y).y;
    const yB = ground(p.x - f.x * 1.4, p.z - f.z * 1.4, p.y).y;
    const yR = ground(p.x + r.x * 0.8, p.z + r.z * 0.8, p.y).y;
    const yL = ground(p.x - r.x * 0.8, p.z - r.z * 0.8, p.y).y;
    const tp = Math.atan2(yF - yB, 2.8);
    const tr = Math.atan2(yR - yL, 1.6);
    pitch += (Math.max(-0.4, Math.min(0.4, tp)) - pitch) * (1 - Math.exp(-14 * dt));
    roll += (Math.max(-0.4, Math.min(0.4, tr)) - roll) * (1 - Math.exp(-14 * dt));
    slope = Math.sin(pitch);
    if (p.y < -400) resetToPit();

    // Suspension: squat / dive with acceleration, lean with cornering.
    const accel = (s.vF - lastVF) / Math.max(dt, 1e-3);
    lastVF = s.vF;
    const lat = s.vF * s.yawRate;
    bodyPitch += (Math.max(-0.035, Math.min(0.03, accel * 0.0022)) - bodyPitch) * (1 - Math.exp(-6 * dt));
    bodyRoll += (Math.max(-0.045, Math.min(0.045, lat * 0.0032)) - bodyRoll) * (1 - Math.exp(-6 * dt));

    const speed = kmh(s);
    topSpeed = Math.max(topSpeed, speed);

    // Audio, same calls as the highway game.
    audio?.setEngine(speed, input.gas, true, false, 0, Math.max(0, s.gear - 1));
    audio?.setTireScreech(speed > 20 ? s.slip * (surface === "road" ? 0.8 : 0.25) : 0);
    if (input.horn && !hornOn) {
      hornOn = true;
      audio?.startHorn(false);
    } else if (!input.horn && hornOn) {
      hornOn = false;
      audio?.stopHorn();
    }
  };

  const place = (dt: number) => {
    car.position.set(p.x, p.y, p.z);
    car.rotation.set(pitch, s.heading, roll);
    body.rotation.set(bodyPitch, 0, bodyRoll);

    sun.position.set(p.x + 18, p.y + 30, p.z + 12);
    sun.target.position.set(p.x, p.y, p.z);

    // Camera: same chase framing as the Revuelto, following the heading.
    const speed = kmh(s);
    const speedK = Math.min(1, speed / 340);
    camHeading += wrap(s.heading - camHeading) * (1 - Math.exp(-(camView === "chase" ? 5 : 30) * dt));
    camY += (p.y - camY) * (1 - Math.exp(-8 * dt));
    const pullTarget = input.gas && speed < 345 ? 0.7 : 0;
    camPull += (pullTarget - camPull) * (1 - Math.exp(-(pullTarget > camPull ? 1.6 : 2.4) * dt));
    const fov = (60 + speedK * 12) * aspectFov();
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    shake *= Math.exp(-5 * dt);
    const sh = shake * 0.03;
    const jitter = () => (Math.random() - 0.5) * sh;
    const ch = camView === "chase" ? camHeading : s.heading;
    const f = forward(ch);
    const r = right(ch);
    const pose = camView === "chase" ? null : CAMERA_POSES[camView];
    if (!pose) {
      const back = 6.6 - speedK * 0.8 + camPull * 0.75;
      const up = 2.05 - speedK * 0.25 + camPull * 0.14;
      camera.position.set(p.x - f.x * back + jitter(), camY + up + jitter(), p.z - f.z * back + jitter());
      camera.lookAt(p.x + f.x * 16, camY + 0.85, p.z + f.z * 16);
    } else {
      const at = (o: { dx: number; y: number; z: number }) =>
        new THREE.Vector3(p.x + r.x * o.dx - f.x * o.z, camY + o.y, p.z + r.z * o.dx - f.z * o.z);
      camera.position.copy(at(pose.pos)).add(new THREE.Vector3(jitter(), jitter(), jitter()));
      camera.lookAt(at(pose.look));
    }
  };

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)["__gp"] = {
      THREE,
      scene,
      camera,
      track,
      col,
      terrain,
      state: s,
      pos: p,
      input,
      sim(seconds: number) {
        for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60);
        place(1);
        return { x: p.x, y: p.y, z: p.z, kmh: kmh(s), gear: s.gear, surface };
      },
    };
  }

  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (!paused) step(dt);
    place(dt);
    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.08;
      opts.onHud({ speed: kmh(s), gear: s.gear, distance, topSpeed, surface });
    }
    renderer.render(scene, camera);
  };
  place(1);
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
  container.dataset["sceneReady"] = "1";

  return {
    input,
    setCamera(view) {
      camView = view;
    },
    setPaused(v) {
      paused = v;
      if (v) {
        audio?.setEngine(0, false, false);
        audio?.setTireScreech(0);
        audio?.stopHorn();
        hornOn = false;
      }
    },
    resetToPit,
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      audio?.setEngine(0, false, false);
      audio?.setTireScreech(0);
      audio?.stopHorn();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat as unknown as Record<string, unknown>))
            if ((v as THREE.Texture | null)?.isTexture) (v as THREE.Texture).dispose();
          mat.dispose();
        }
      });
      sky.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      delete container.dataset["sceneReady"];
      if (import.meta.env.DEV) delete (window as unknown as Record<string, unknown>)["__gp"];
    },
  };
}
