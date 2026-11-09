// GP offline practice: Grand Valley Speedway pit stop scene (browser only;
// import dynamically). The track is the user-supplied GLB, used as-is.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { fetchGlb, parseGlb } from "./models3d";
import { normalizeCar } from "./normalize-car";
import { GP_CARS } from "./gp-cars";

export const TRACK_URL = "/game-assets/grand-valley-speedway.glb";

/** Pit box in front of the garages on the main straight (track units are metres; garages lie at +Z). */
const PIT = { x: -110, z: -752, heading: Math.PI / 2 };
/** The camera orbits on the pit-lane side only, never inside the garages. */
const AZ_MIN = Math.PI / 2 + 0.3;
const AZ_MAX = (3 * Math.PI) / 2 - 0.3;

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
  grad.addColorStop(0.49, "#d9e6ef");
  grad.addColorStop(0.5, "#b9c4b0");
  grad.addColorStop(1, "#4d5a3c");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  // soft cumulus band above the horizon
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 1024;
    const y = 120 + Math.random() * 110;
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

export type PitHandle = { dispose: () => void };

export async function mountPit(
  container: HTMLElement,
  model: { url: string; length: number; yaw: number },
): Promise<PitHandle> {
  const [trackBuf, carBuf] = await Promise.all([load(TRACK_URL), load(model.url)]);
  const [track, carScene] = await Promise.all([
    parseGlb(trackBuf.slice(0)),
    parseGlb(carBuf.slice(0)),
  ]);

  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
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
  scene.fog = new THREE.Fog(0xc9d6de, 250, 2600);
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
  sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
  sun.shadow.camera.right = sun.shadow.camera.top = 8;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // Track as supplied; it is unlit-textured, so it never needs scene lights.
  track.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map) map.anisotropy = 8;
    }
  });
  scene.add(track);
  track.updateMatrixWorld(true);

  // Ground height at the pit box.
  const ray = new THREE.Raycaster(
    new THREE.Vector3(PIT.x, 500, PIT.z),
    new THREE.Vector3(0, -1, 0),
  );
  const hit = ray.intersectObject(track, true)[0];
  const groundY = hit ? hit.point.y : 0;

  const car = normalizeCar(carScene, model);
  car.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  const pit = new THREE.Group();
  pit.position.set(PIT.x, groundY + 0.02, PIT.z);
  pit.rotation.y = PIT.heading;
  pit.add(car);

  const box = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 6.4),
    new THREE.MeshBasicMaterial({ map: pitBoxTexture(), transparent: true, depthWrite: false }),
  );
  box.rotation.x = -Math.PI / 2;
  box.position.y = 0.01;
  pit.add(box);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.ShadowMaterial({ opacity: 0.45 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  shadow.receiveShadow = true;
  pit.add(shadow);

  // Tyre stacks beside the box.
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
      t.castShadow = true;
      pit.add(t);
    }
  }
  scene.add(pit);
  pit.updateMatrixWorld(true);

  const center = new THREE.Vector3(0, 0.6, 0).applyMatrix4(pit.matrixWorld);
  sun.position.copy(center).add(new THREE.Vector3(18, 30, 12));
  sun.target.position.copy(center);

  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 4000);
  // Portrait phones are narrow: widen the lens and step back so the whole car fits.
  const frameDistance = (aspect: number) => {
    camera.fov = aspect < 1 ? 52 : 40;
    camera.updateProjectionMatrix();
    const half = Math.tan((camera.fov * Math.PI) / 360) * Math.min(1, aspect);
    return Math.min(16, Math.max(8.5, 3.1 / half));
  };
  camera.position
    .copy(center)
    .add(new THREE.Vector3(1, 0.36, -1).normalize().multiplyScalar(frameDistance(w / h)));
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.minDistance = 4;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minAzimuthAngle = AZ_MIN;
  controls.maxAzimuthAngle = -(2 * Math.PI - AZ_MAX);
  controls.update();
  let resume: ReturnType<typeof setTimeout> | undefined;
  const onStart = () => {
    clearTimeout(resume);
    controls.autoRotate = false;
  };
  const onEnd = () => {
    clearTimeout(resume);
    resume = setTimeout(() => (controls.autoRotate = true), 2500);
  };
  controls.addEventListener("start", onStart);
  controls.addEventListener("end", onEnd);

  const observer = new ResizeObserver(() => {
    const cw = Math.max(1, container.clientWidth);
    const ch = Math.max(1, container.clientHeight);
    camera.aspect = cw / ch;
    frameDistance(camera.aspect);
    renderer.setSize(cw, ch);
  });
  observer.observe(container);

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)["__gp"] = { THREE, scene, camera, controls, track, pit };
  }

  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (controls.autoRotate) {
      // Ping-pong sweep along the pit lane (positive speed lowers the azimuth).
      const a = (controls.getAzimuthalAngle() + Math.PI * 2) % (Math.PI * 2);
      const s = Math.abs(controls.autoRotateSpeed);
      if (a < AZ_MIN + 0.05) controls.autoRotateSpeed = -s;
      else if (a > AZ_MAX - 0.05) controls.autoRotateSpeed = s;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  frame();
  container.dataset["sceneReady"] = "1";

  return {
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(resume);
      observer.disconnect();
      controls.dispose();
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
    },
  };
}
