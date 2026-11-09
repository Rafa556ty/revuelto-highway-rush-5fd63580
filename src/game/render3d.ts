// three.js renderer for the racing game. Browser only: import dynamically.
// It never simulates anything; it only draws the RenderSnapshot the engine
// produces every frame. Sim coordinates are pixels; `ppm` converts to metres.
// World: player near the origin, forward = -Z, road scenery scrolls with pz.
import * as THREE from "three";
import { contactTexture, loadRoadLighting } from "./road-lighting";
import { shadowOffset } from "./device-ui";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { RenderSnapshot } from "./engine";
import type { CarType } from "./traffic";
import { loadCar, type ModelKey } from "./models3d";
import { FOOTPRINTS, TRAFFIC_DRAW_AHEAD } from "./traffic-rules";
import { CAMERA_POSES, nextCameraView, type CameraView } from "./camera-views";
import {
  stepAero,
  stepTrafficWing,
  TRAFFIC_WING_RISE,
  TRAFFIC_WING_TILT,
  type AeroState,
} from "./aero";
import { wheelOmega } from "./wheels";
import { AdaptiveResolution, phoneProfile } from "./quality";
import {
  BRIDGES,
  CYCLE,
  SIGN_GANTRIES,
  SPEED_RADARS,
  TUNNEL_FROM,
  TUNNEL_TO,
  cyc,
  inTunnel,
  lightsOn,
  nightAmount,
  rainAmount,
} from "./world";

const LANE_W = 3.6;
const ROAD_W = LANE_W * 3;
const SHOULDER = 1.6;
const DECK_W = ROAD_W + SHOULDER * 2; // asphalt incl. shoulders
const VIEW_AHEAD = 260;
// Deep rear view: the reverse camera looks back, so road, scenery and traffic
// stay rendered well behind the car instead of vanishing.
const VIEW_BEHIND = 110;
const TILE_LEN = 24; // metres of road per texture tile
const STRIP_LEN = VIEW_AHEAD + VIEW_BEHIND;

type TrafficKey = ModelKey;
const TYPE_MODEL: Record<CarType, TrafficKey> = {
  m5: "hatch",
  "mustang-blue": "mustang",
  "mustang-black": "mustang",
  "bmw-m3": "bmw",
  "porsche-gt3": "porsche",
  "bugatti-chiron": "bugatti",
  "ferrari-sf90": "ferrari",
  bus: "bus",
  truck: "truck",
  suv: "suv",
  sedan: "sedan",
  hatch: "hatch",
  pickup: "pickup",
};
const MODEL_FOOTPRINT: Partial<Record<TrafficKey, [number, number]>> = {
  hatch: FOOTPRINTS.hatch,
  sedan: FOOTPRINTS.sedan,
  suv: FOOTPRINTS.suv,
  pickup: FOOTPRINTS.pickup,
  bus: FOOTPRINTS.bus,
  truck: FOOTPRINTS.truck,
  mustang: FOOTPRINTS["mustang-blue"],
  bmw: FOOTPRINTS["bmw-m3"],
  porsche: FOOTPRINTS["porsche-gt3"],
  bugatti: FOOTPRINTS["bugatti-chiron"],
  ferrari: FOOTPRINTS["ferrari-sf90"],
};

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- procedural textures ----------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const context = c.getContext("2d");
  if (!context) throw new Error("Canvas context unavailable");
  draw(context);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function noise(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  n: number,
  colors: string[],
  size: [number, number],
) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length] ?? "#45474c";
    const s = size[0] + Math.random() * (size[1] - size[0]);
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

function roadTexture(asphalt?: HTMLImageElement | HTMLCanvasElement) {
  const W = 1024;
  const H = 2048;
  return canvasTex(W, H, (g) => {
    g.fillStyle = "#3a3c40";
    g.fillRect(0, 0, W, H);
    if (asphalt) {
      for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256)
        g.drawImage(asphalt, x, y, 256, 256);
      g.fillStyle = "rgba(10,12,15,0.22)";
      g.fillRect(0, 0, W, H);
    } else noise(g, W, H, 38000, ["#3d3f42", "#36383b", "#414346", "#383a3d"], [0.5, 1.5]);
    // tyre-polished lane centres
    const px = W / DECK_W;
    for (let l = 0; l < 3; l++) {
      const cx = (SHOULDER + LANE_W * (l + 0.5)) * px;
      for (const off of [-0.85, 0.85]) {
        const grd = g.createLinearGradient(cx + off * px - 18, 0, cx + off * px + 18, 0);
        grd.addColorStop(0, "rgba(20,20,22,0)");
        grd.addColorStop(0.5, "rgba(20,20,22,0.22)");
        grd.addColorStop(1, "rgba(20,20,22,0)");
        g.fillStyle = grd;
        g.fillRect(cx + off * px - 18, 0, 36, H);
      }
    }
    // shoulder edge lines (solid)
    g.fillStyle = "#ece8dc";
    g.fillRect(SHOULDER * px - 6, 0, 8, H);
    g.fillRect((SHOULDER + ROAD_W) * px - 2, 0, 8, H);
    // dashed lane lines: 4 m dash, 8 m gap
    const mpy = H / TILE_LEN;
    for (const l of [1, 2]) {
      const x = (SHOULDER + LANE_W * l) * px - 3;
      for (let z = 0; z < TILE_LEN; z += 12) g.fillRect(x, z * mpy, 6, 4 * mpy);
    }
    // rumble strips on the shoulders
    g.fillStyle = "rgba(230,230,220,0.35)";
    for (let y = 0; y < H; y += 14) {
      g.fillRect(SHOULDER * px - 22, y, 12, 6);
      g.fillRect((SHOULDER + ROAD_W) * px + 10, y, 12, 6);
    }
  });
}

function grassTexture() {
  return canvasTex(512, 512, (g) => {
    g.fillStyle = "#3f5f2a";
    g.fillRect(0, 0, 512, 512);
    noise(g, 512, 512, 30000, ["#4c6f32", "#36521f", "#5a7e3a", "#2f4a1b", "#6a7f3c"], [1, 4]);
  });
}

function concreteTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = "#8d8a84";
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 9000, ["#9a978f", "#7f7c76", "#a5a29a"], [1, 3]);
  });
}

function signTexture(lines: string[]) {
  return canvasTex(512, 192, (g) => {
    g.fillStyle = "#0f6b3a";
    g.fillRect(0, 0, 512, 192);
    g.strokeStyle = "#f2f2f2";
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 176);
    g.fillStyle = "#f7f7f7";
    g.font = "bold 46px Arial, sans-serif";
    g.textBaseline = "middle";
    lines.forEach((l, i) => g.fillText(l, 30, 60 + i * 70));
  });
}

function radialTex(stops: [number, string][]) {
  const t = canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, c] of stops) grd.addColorStop(o, c);
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- exhaust flame shader ----------
const flameVert = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uSeed;
  void main() {
    vUv = uv;
    vec3 p = position;
    // turbulent wobble grows toward the tip
    float t = uv.y;
    p.x += sin(uTime * 41.0 + t * 9.0 + uSeed) * 0.02 * t;
    p.y += cos(uTime * 37.0 + t * 7.0 + uSeed * 2.0) * 0.02 * t;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const flameFrag = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uSeed;
  uniform float uCore;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y);
  }
  void main() {
    float t = vUv.y; // 0 = exhaust tip, 1 = flame end
    float ang = vUv.x * 6.2831;
    float turb = n(vec2(ang * 1.5 + uSeed, t * 6.0 - uTime * 28.0)) * 0.6
               + n(vec2(ang * 3.0, t * 14.0 - uTime * 45.0)) * 0.4;
    float body = pow(1.0 - t, 1.3) * (0.55 + turb * 0.9);
    body *= smoothstep(0.0, 0.06, t);
    vec3 blue = vec3(0.45, 0.65, 1.0);
    vec3 white = vec3(1.0, 0.95, 0.85);
    vec3 orange = vec3(1.0, 0.45, 0.08);
    vec3 red = vec3(0.7, 0.08, 0.02);
    vec3 col = mix(blue, white, smoothstep(0.02, 0.15, t));
    col = mix(col, orange, smoothstep(0.15, 0.45, t));
    col = mix(col, red, smoothstep(0.55, 0.95, t));
    col = mix(col, mix(blue, white, t * 3.0), uCore);
    float a = clamp(body * uIntensity, 0.0, 1.0);
    gl_FragColor = vec4(col * (1.6 + uCore), a);
  }
`;

type Flame = {
  group: THREE.Group;
  outer: THREE.ShaderMaterial;
  core: THREE.ShaderMaterial;
  glow: THREE.Sprite;
  light: THREE.PointLight;
};

export class Scene3D {
  private low = phoneProfile({
    userAgent: navigator.userAgent,
    memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    cores: navigator.hardwareConcurrency || 4,
    touch: navigator.maxTouchPoints > 0,
  });
  private quality = new AdaptiveResolution();
  private width = 1;
  private height = 1;
  private lastFrame = 0;
  private baseDpr = 1;
  private rainColor = new THREE.Color(0x707a86);
  private matrix = new THREE.Matrix4();
  private quaternion = new THREE.Quaternion();
  private scaleVector = new THREE.Vector3();
  private positionVector = new THREE.Vector3();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fog: THREE.Fog;
  private sky = new THREE.Color();
  private daySky: THREE.Texture;
  private dayColor = new THREE.Color(0xa9cbe8);
  private duskColor = new THREE.Color(0x3a3550);
  private nightColor = new THREE.Color(0x05070d);
  private tunnelColor = new THREE.Color(0x14120f);

  private roadTex: THREE.CanvasTexture;
  private grassTex: THREE.CanvasTexture;
  private roadMat: THREE.MeshStandardMaterial;
  private reflectionMaps: Awaited<ReturnType<typeof loadRoadLighting>> | undefined;
  private contactTex: THREE.CanvasTexture;
  private roadDetail: THREE.Texture | undefined;
  private disposed = false;
  private lightHalos: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; kind: "tail" | "head" | "brake" }[] = [];
  private playerShadow: THREE.Mesh | undefined;
  private sunShadow: THREE.Mesh | undefined;

  private posts!: THREE.InstancedMesh;
  private trunks!: THREE.InstancedMesh;
  private crowns!: THREE.InstancedMesh;
  private lampPoles!: THREE.InstancedMesh;
  private lampHeads!: THREE.InstancedMesh;
  private lampPools!: THREE.InstancedMesh;
  private lampHeadMat!: THREE.MeshStandardMaterial;
  private lampPoolMat!: THREE.MeshBasicMaterial;

  private tunnel!: THREE.Group;
  private tunnelLightMat!: THREE.MeshStandardMaterial;
  private tunnelLamp: THREE.PointLight;
  private bridges: THREE.Group[] = [];
  private gantries: THREE.Group[] = [];
  private radars: THREE.Group[] = [];

  private player: THREE.Group | null = null;
  private wing: THREE.Object3D | undefined;
  private aero: AeroState = { lift: 0, tilt: 0 };
  private buildings: THREE.InstancedMesh | undefined;
  private rooftops: THREE.InstancedMesh | undefined;
  private cityMaterial: THREE.MeshStandardMaterial | undefined;
  private playerTail: THREE.MeshStandardMaterial[] = [];
  private playerHead: THREE.MeshStandardMaterial[] = [];
  private playerBrakeOnly: THREE.MeshStandardMaterial[] = [];
  private playerWheels: { mesh: THREE.Mesh; radius: number }[] = [];
  private engineBrakeLight: THREE.Mesh | null = null;
  private rimWarm = new THREE.DirectionalLight(0xffb347, 1.5);
  private rimCool = new THREE.DirectionalLight(0x7fb2ff, 0.8);
  private roadBeamMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private headL: THREE.SpotLight;
  private headR: THREE.SpotLight;
  private flames: Flame[] = [];
  private flameAmt = 0;
  private flameLen = 0;
  private popT = 0;

  private templates = new Map<TrafficKey, THREE.Group>();
  private policeCar: THREE.Group | null = null;
  private policeRed: THREE.MeshStandardMaterial | null = null;
  private policeBlue: THREE.MeshStandardMaterial | null = null;
  private sprites: THREE.Sprite[] = [];
  private smokeTex: THREE.Texture;
  private sparkTex: THREE.Texture;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;

  private time = 0;
  private camX = 0;
  private camPull = 0;
  private camView: CameraView = "chase";
  private ready = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLElement | null,
    private onReady?: () => void,
  ) {
    // Preserve detail at CSS resolution; reduce draw calls rather than crushing pixels.
    const dpr = Math.min(window.devicePixelRatio || 1, this.low ? 1 : 1.5);
    this.baseDpr = dpr;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      stencil: false,
      precision: "highp",
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.fog = new THREE.Fog(0xa9cbe8, 60, VIEW_AHEAD - 10);
    this.scene.fog = this.fog;
    this.scene.background = this.sky;
    // A local panoramic sky provides natural horizon haze and cloud detail.
    const skyMap = canvasTex(1024, 512, (g) => {
      const gradient = g.createLinearGradient(0, 0, 0, 512);
      gradient.addColorStop(0, "#598fc4");
      gradient.addColorStop(0.48, "#a8cbe5");
      gradient.addColorStop(0.7, "#e5e9e9");
      gradient.addColorStop(1, "#94a287");
      g.fillStyle = gradient;
      g.fillRect(0, 0, 1024, 512);
      for (let i = 0; i < 45; i++) {
        const x = hash(i * 3) * 1024;
        const y = 160 + hash(i * 7) * 90;
        const cloud = g.createRadialGradient(x, y, 0, x, y, 70);
        cloud.addColorStop(0, "rgba(255,255,255,0.22)");
        cloud.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = cloud;
        g.save();
        g.translate(x, y);
        g.scale(1, 0.22);
        g.translate(-x, -y);
        g.fillRect(x - 70, y - 70, 140, 140);
        g.restore();
      }
    });
    skyMap.mapping = THREE.EquirectangularReflectionMapping;
    this.daySky = skyMap;

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x3b4a2a, 0.9);
    this.scene.add(this.hemi);
    // Restrained sky fill, not bright indoor studio rim lighting.
    this.rimWarm.position.set(-6, 3, -5);
    this.rimCool.position.set(5, 2, -6);
    this.scene.add(this.rimWarm, this.rimCool);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 22;
    sc.bottom = -22;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.tunnelLamp = new THREE.PointLight(0xffc98a, 0, 26, 1.6);
    this.scene.add(this.tunnelLamp);

    this.headL = this.makeHeadlight();
    this.headR = this.makeHeadlight();

    this.roadTex = roadTexture();
    this.roadTex.repeat.set(1, STRIP_LEN / TILE_LEN);
    this.grassTex = grassTexture();
    this.grassTex.repeat.set(10, STRIP_LEN / 8);
    this.roadMat = new THREE.MeshStandardMaterial({
      map: this.roadTex,
      roughness: 0.88,
      metalness: 0.02,
      bumpMap: this.roadTex,
      bumpScale: 0.012,
    });

    this.smokeTex = radialTex([
      [0, "rgba(255,255,255,0.9)"],
      [0.5, "rgba(255,255,255,0.35)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    this.sparkTex = radialTex([
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(255,200,90,0.9)"],
      [1, "rgba(255,90,0,0)"],
    ]);
    this.contactTex = contactTexture();

    this.buildWorld();

    // Rain: streaks in a box around the camera
    const N = this.low ? 80 : 500;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this.resetDrop(i, true);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({
        color: 0xcfe2ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);

    for (let i = 0; i < (this.low ? 12 : 96); i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false }),
      );
      s.visible = false;
      this.sprites.push(s);
      this.scene.add(s);
    }

    void this.loadModels();
    void loadRoadLighting(this.renderer).then((maps) => {
      if (this.disposed) {
        maps.day.dispose(); maps.night.dispose(); maps.tunnel.dispose();
        maps.sky.dispose(); maps.asphalt.dispose();
        return;
      }
      this.daySky.dispose();
      this.daySky = maps.sky;
      this.reflectionMaps = maps;
      this.scene.environment = maps.day.texture;
      const road = roadTexture(maps.asphalt.image as HTMLImageElement);
      road.repeat.set(1, STRIP_LEN / TILE_LEN);
      this.roadMat.map = road;
      this.roadTex.dispose();
      this.roadTex = road;
      // Fine aggregate data map excludes painted lines and repeats at metre scale.
      const detail = maps.asphalt.clone();
      detail.colorSpace = THREE.NoColorSpace;
      detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
      detail.repeat.set(DECK_W / 3.5, STRIP_LEN / 3.5);
      detail.anisotropy = this.low ? 4 : 8;
      detail.needsUpdate = true;
      this.roadDetail = detail;
      this.roadMat.bumpMap = this.roadMat.roughnessMap = detail;
      this.roadMat.bumpScale = 0.008;
      this.roadMat.needsUpdate = true;
      this.canvas.dataset["roadLightingReady"] = "true";
    }).catch((error) => console.error("Road lighting failed", error));
  }

  private makeHeadlight() {
    const s = new THREE.SpotLight(0xfff4e0, 0, 90, 0.42, 0.55, 1.2);
    if (!this.low) this.scene.add(s, s.target);
    return s;
  }

  private resetDrop(i: number, anywhere: boolean) {
    const x = (Math.random() - 0.5) * 40;
    const z = -Math.random() * 60 + 8;
    const y = anywhere ? Math.random() * 18 : 18;
    const o = i * 6;
    this.rainPos.set([x, y, z, x - 0.05, y - 0.9, z + 0.25], o);
  }

  // ---------- static + scrolling world ----------
  private buildWorld() {
    const mid = -(VIEW_AHEAD - VIEW_BEHIND) / 2;

    const road = new THREE.Mesh(new THREE.PlaneGeometry(DECK_W, STRIP_LEN), this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.z = mid;
    road.receiveShadow = true;
    this.scene.add(road);

    const gravelMat = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 1 });
    const grassMat = new THREE.MeshStandardMaterial({ map: this.grassTex, roughness: 1 });
    for (const side of [-1, 1]) {
      const gravel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, STRIP_LEN), gravelMat);
      gravel.rotation.x = -Math.PI / 2;
      gravel.position.set(side * (DECK_W / 2 + 1.1), -0.02, mid);
      gravel.receiveShadow = true;
      const grass = new THREE.Mesh(new THREE.PlaneGeometry(160, STRIP_LEN), grassMat);
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(side * (DECK_W / 2 + 2.2 + 80), -0.05, mid);
      grass.receiveShadow = true;
      this.scene.add(gravel, grass);

      // W-beam guardrail (continuous)
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.32, STRIP_LEN),
        new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.85, roughness: 0.35 }),
      );
      rail.position.set(side * (DECK_W / 2 + 0.45), 0.62, mid);
      rail.castShadow = true;
      this.scene.add(rail);
    }

    const postGeo = new THREE.BoxGeometry(0.12, 0.75, 0.12);
    postGeo.translate(0, 0.37, 0);
    this.posts = new THREE.InstancedMesh(
      postGeo,
      new THREE.MeshStandardMaterial({ color: 0x6a6e74, metalness: 0.6, roughness: 0.5 }),
      160,
    );
    this.scene.add(this.posts);

    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 3.0, 7);
    trunkGeo.translate(0, 1.5, 0);

    // Realistic tiered highway pine/cypress foliage canopy (no low-poly broccoli icosahedron)
    const tier1 = new THREE.ConeGeometry(2.35, 2.7, 7);
    tier1.translate(0, 3.2, 0);
    const tier2 = new THREE.ConeGeometry(1.85, 2.3, 7);
    tier2.translate(0, 4.7, 0);
    const tier3 = new THREE.ConeGeometry(1.25, 1.9, 7);
    tier3.translate(0, 6.0, 0);
    const crownGeo = mergeGeometries([tier1, tier2, tier3]) || tier1;
    crownGeo.computeVertexNormals();
    tier1.dispose();
    tier2.dispose();
    tier3.dispose();

    this.trunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.95 }),
      140,
    );
    this.crowns = new THREE.InstancedMesh(
      crownGeo,
      new THREE.MeshStandardMaterial({
        color: 0x1d3d18,
        roughness: 0.82,
        flatShading: false,
      }),
      140,
    );
    this.crowns.castShadow = true;
    this.scene.add(this.trunks, this.crowns);

    const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 9, 8);
    poleGeo.translate(0, 4.5, 0);
    this.lampPoles = new THREE.InstancedMesh(
      poleGeo,
      new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.4 }),
      24,
    );
    const headGeo = new THREE.BoxGeometry(1.8, 0.18, 0.5);
    headGeo.translate(0, 9, 0);
    this.lampHeadMat = new THREE.MeshStandardMaterial({
      color: 0x777777,
      emissive: 0xffd9a0,
      emissiveIntensity: 0,
    });
    this.lampHeads = new THREE.InstancedMesh(headGeo, this.lampHeadMat, 24);
    const poolGeo = new THREE.CircleGeometry(5.5, 24);
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.translate(0, 0.02, 0);
    this.lampPoolMat = new THREE.MeshBasicMaterial({
      map: radialTex([
        [0, "rgba(255,210,150,0.8)"],
        [1, "rgba(255,210,150,0)"],
      ]),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lampPools = new THREE.InstancedMesh(poolGeo, this.lampPoolMat, 24);
    this.scene.add(this.lampPoles, this.lampHeads, this.lampPools);

    this.buildTunnel();

    const facade = canvasTex(256, 512, (g) => {
      g.fillStyle = "#a8afb0";
      g.fillRect(0, 0, 256, 512);
      noise(g, 256, 512, 7000, ["#9aa3a5", "#b6bbba", "#8f999e"], [1, 2]);
      for (let y = 14; y < 512; y += 32)
        for (let x = 12; x < 256; x += 32) {
          g.fillStyle = hash(x + y * 2) > 0.73 ? "#d1c8a1" : "#3c5965";
          g.fillRect(x, y, 17, 22);
          g.fillStyle = "#ccd1d0";
          g.fillRect(x - 1, y + 22, 19, 2);
        }
    });
    this.cityMaterial = new THREE.MeshStandardMaterial({
      map: facade,
      roughness: 0.72,
      metalness: 0.12,
      emissiveMap: facade,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    this.buildings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      this.cityMaterial,
      72,
    );
    this.rooftops = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x69747c, roughness: 0.8 }),
      72,
    );
    this.buildings.frustumCulled = this.rooftops.frustumCulled = false;
    this.scene.add(this.buildings, this.rooftops);

    const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 });
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(DECK_W + 30, 1.2, 12), concrete);
      deck.position.y = 6.6;
      deck.castShadow = true;
      g.add(deck);
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(DECK_W + 30, 0.9, 0.3), concrete);
      barrier.position.set(0, 7.6, 5.8);
      g.add(barrier, barrier.clone().translateZ(-11.6));
      for (const x of [-(DECK_W / 2 + 2.4), 0, DECK_W / 2 + 2.4]) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(x === 0 ? 0.6 : 1.2, 6.2, 3), concrete);
        pier.position.set(x, 3.0, 0);
        pier.castShadow = true;
        if (x !== 0) g.add(pier);
      }
      g.visible = false;
      this.bridges.push(g);
      this.scene.add(g);
    }

    const steel = new THREE.MeshStandardMaterial({
      color: 0x9aa0a6,
      metalness: 0.8,
      roughness: 0.35,
    });
    const signs = [
      ["São Paulo  42 km", "Campinas  96 km"],
      ["Saída 23  →", "Interlagos"],
      ["Rodovia dos", "Bandeirantes"],
    ];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7.2, 8), steel);
        leg.position.set(s * (DECK_W / 2 + 0.9), 3.6, 0);
        g.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(DECK_W + 2, 0.5, 0.5), steel);
      beam.position.y = 6.9;
      g.add(beam);
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(6.5, 2.4, 0.15),
        new THREE.MeshStandardMaterial({
          map: signTexture(signs[i] ?? []),
          roughness: 0.5,
          emissive: 0xffffff,
          emissiveIntensity: 0,
          emissiveMap: null,
        }),
      );
      sign.position.set(-1.8, 6.2, 0.35);
      g.add(sign);
      g.traverse((o) => (o.castShadow = true));
      g.visible = false;
      this.gantries.push(g);
      this.scene.add(g);
    }

    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5.2, 8), steel);
      pole.position.y = 2.6;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.5, 0.7),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }),
      );
      box.position.set(-0.3, 5.2, 0);
      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(0.15, 16),
        new THREE.MeshBasicMaterial({ color: 0x111111 }),
      );
      lens.position.set(-0.3, 5.2, -0.36);
      lens.rotation.y = Math.PI;
      g.add(pole, box, lens);
      g.position.x = DECK_W / 2 + 1.6;
      g.visible = false;
      this.radars.push(g);
      this.scene.add(g);
    }
  }

  private buildTunnel() {
    const len = TUNNEL_TO - TUNNEL_FROM;
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.75 });
    const tileMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.35 });
    const ceilMat = new THREE.MeshStandardMaterial({
      color: 0x2b2a28,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.5, len), wallMat);
      wall.position.set(s * (DECK_W / 2 + 0.6), 3.25, -len / 2);
      const tiles = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, len), tileMat);
      tiles.position.set(s * (DECK_W / 2 + 0.3), 1.4, -len / 2);
      g.add(wall, tiles);
    }
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(DECK_W + 1.7, 0.4, len), ceilMat);
    ceil.position.set(0, 6.6, -len / 2);
    g.add(ceil);
    // portal facade
    const portal = new THREE.Mesh(
      new THREE.BoxGeometry(DECK_W + 18, 9, 1.2),
      new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 }),
    );
    portal.position.set(0, 10.4, 0.6);
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 1.2), portal.material);
    sideL.position.set(-(DECK_W / 2 + 4.9), 3, 0.6);
    const sideR = sideL.clone();
    sideR.position.x *= -1;
    const exit = portal.clone();
    exit.position.z = -len - 0.6;
    const exitL = sideL.clone();
    exitL.position.z = -len - 0.6;
    const exitR = sideR.clone();
    exitR.position.z = -len - 0.6;
    g.add(portal, sideL, sideR, exit, exitL, exitR);

    // fluorescent strip lights every 8 m, two rows
    this.tunnelLightMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffd7a0,
      emissiveIntensity: 2.5,
    });
    const n = Math.floor(len / 8);
    const strips = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.25, 0.08, 3.2),
      this.tunnelLightMat,
      n * 2,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeTranslation(-2.2, 6.36, -i * 8 - 4);
      strips.setMatrixAt(i * 2, m);
      m.makeTranslation(2.2, 6.36, -i * 8 - 4);
      strips.setMatrixAt(i * 2 + 1, m);
    }
    g.add(strips);
    g.visible = false;
    this.tunnel = g;
    this.scene.add(g);
  }

  // ---------- models ----------
  private async loadModels() {
    const player = await loadCar("revuelto").catch((e) => {
      console.error("Revuelto model failed", e);
      return null;
    });
    if (player) this.setupPlayer(player.clone(true));
    const keys: ModelKey[] = [
      "hatch",
      "sedan",
      "suv",
      "pickup",
      "bus",
      "truck",
      "mustang",
      "bmw",
      "porsche",
      "bugatti",
      "ferrari",
    ];
    await Promise.all(
      keys.map((k) =>
        loadCar(k)
          .then((t) => {
            this.templates.set(k, t);
            this.setupTrafficBatch(k, t);
            if (k === "mustang") this.setupPolice(t.clone(true));
          })
          .catch((e) => console.error(`model ${k} failed`, e)),
      ),
    );
    await this.renderer.compileAsync(this.scene, this.camera);
    this.canvas.dataset["modelsReady"] = "true";
  }

  private setupPlayer(car: THREE.Group) {
    const exhausts: THREE.Vector3[] = [];
    const box = new THREE.Box3();
    car.updateMatrixWorld(true);
    car.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const material of mats) material.forceSinglePass = true;
      mats.forEach((mat, i) => {
        const name = (mat.name || "").toLowerCase();
        if (name === "tail_light_brake" || name.includes("brake_light")) {
          // Strictly brake-only red line near the engine: OFF unless actively braking
          const c = (mat as THREE.MeshStandardMaterial).clone();
          c.emissive = new THREE.Color(0xff0600);
          c.emissiveIntensity = 0;
          c.toneMapped = false;
          if (Array.isArray(m.material)) m.material[i] = c;
          else m.material = c;
          this.playerBrakeOnly.push(c);
        } else if (name.startsWith("tail") || name === "taillight_rear" || name === "taillight_glass") {
          // Signature Y-shaped running taillights
          const c = (mat as THREE.MeshStandardMaterial).clone();
          // Pure red like the reference photo; tone mapping turned it orange.
          c.emissive = new THREE.Color(0xff0a02);
          c.emissiveIntensity = 0.8;
          c.toneMapped = false;
          if (Array.isArray(m.material)) m.material[i] = c;
          else m.material = c;
          this.playerTail.push(c);
        } else if (name.includes("headlight") || name.includes("daylight") || name === "light") {
          // Xenon white headlights and Y-daytime running lights
          const c = (mat as THREE.MeshStandardMaterial).clone();
          c.emissive = new THREE.Color(0xfff6ec);
          c.emissiveIntensity = 0.6;
          if (Array.isArray(m.material)) m.material[i] = c;
          else m.material = c;
          this.playerHead.push(c);
        } else if (name === "exhaust") {
          box.setFromObject(m);
          const c = box.getCenter(new THREE.Vector3());
          c.z = box.max.z;
          exhausts.push(c);
        }
      });
    });

    // Signature Revuelto engine-bay red brake contour strip (from reference photo)
    const brakeCurvePoints = [
      new THREE.Vector3(-0.46, 0.94, 1.25),
      new THREE.Vector3(-0.40, 0.955, 1.48),
      new THREE.Vector3(-0.28, 0.965, 1.62),
      new THREE.Vector3(0.0, 0.968, 1.64),
      new THREE.Vector3(0.28, 0.965, 1.62),
      new THREE.Vector3(0.40, 0.955, 1.48),
      new THREE.Vector3(0.46, 0.94, 1.25),
    ];
    const brakeCurve = new THREE.CatmullRomCurve3(brakeCurvePoints);
    const brakeGeo = new THREE.TubeGeometry(brakeCurve, 32, 0.016, 8, false);
    const brakeMat = new THREE.MeshBasicMaterial({
      color: 0xff1505,
      transparent: true,
      opacity: 0.98,
      toneMapped: false,
    });
    const brakeMesh = new THREE.Mesh(brakeGeo, brakeMat);
    brakeMesh.name = "engine-cowl-brake-strip";
    brakeMesh.visible = false;
    car.add(brakeMesh);
    this.engineBrakeLight = brakeMesh;

    // The batched car merges both exhaust pipes into one mesh, so split its
    // vertices by side: one flame per real outlet (Revuelto has twin pipes).
    const tips: THREE.Vector3[] = [];
    car.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || tips.length) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if ((mat?.name || "").toLowerCase() !== "exhaust") return;
      const pos = m.geometry.getAttribute("position");
      const v = new THREE.Vector3();
      const side = [new THREE.Box3(), new THREE.Box3()];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        side[v.x < 0 ? 0 : 1]!.expandByPoint(v);
      }
      for (const b of side) {
        if (b.isEmpty()) continue;
        const c = b.getCenter(new THREE.Vector3());
        c.z = b.max.z;
        tips.push(c);
      }
    });
    if (tips.length !== 2) {
      tips.length = 0;
      tips.push(new THREE.Vector3(-0.14, 0.78, 2.45), new THREE.Vector3(0.14, 0.78, 2.45));
    }
    void exhausts;
    for (const tip of tips) this.flames.push(this.makeFlame(car, tip));
    this.headL.position.set(-0.7, 0.75, -2.2);
    this.headR.position.set(0.7, 0.75, -2.2);
    if (!this.low) car.add(this.headL, this.headR);
    this.headL.target.position.set(-0.9, 0, -30);
    this.headR.target.position.set(0.9, 0, -30);
    if (!this.low) car.add(this.headL.target, this.headR.target);
    // Soft contact shadows keep the car grounded without another render pass.
    this.playerShadow = this.addContactShadow(this.scene, 2.25, 5.0);
    // Softer cast shadow that slides with the sun / tunnel lamps.
    this.sunShadow = this.addContactShadow(this.scene, 2.9, 5.9);
    this.sunShadow.position.y = 0.016;
    const haloMap = radialTex([[0, "rgba(255,255,255,0.5)"], [0.18, "rgba(255,255,255,0.22)"], [0.55, "rgba(255,255,255,0.06)"], [1, "rgba(255,255,255,0)"]]);
    const halo = (x: number, y: number, z: number, kind: "tail" | "head" | "brake", size: number) => {
      const material = new THREE.MeshBasicMaterial({ map: haloMap, color: kind === "head" ? 0xfff4e6 : 0xff0a02, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.65), material);
      mesh.position.set(x, y, z);
      if (kind === "head") mesh.rotation.y = Math.PI;
      car.add(mesh);
      this.lightHalos.push({ mesh, kind });
    };
    for (const x of [-0.79, 0.79]) {
      halo(x, 0.73, 2.43, "tail", 0.72);
      halo(x, 0.56, -2.47, "head", 0.56);
    }
    halo(0, 0.98, 1.67, "brake", 0.65);

    // High-visibility dual headlight beam projector onto the highway tarmac
    const beamTex = canvasTex(512, 1024, (g) => {
      g.clearRect(0, 0, 512, 1024);
      for (const cx of [185, 327]) {
        const grd = g.createRadialGradient(cx, 160, 20, cx, 520, 480);
        grd.addColorStop(0, "rgba(255, 248, 225, 0.85)");
        grd.addColorStop(0.35, "rgba(255, 238, 195, 0.45)");
        grd.addColorStop(0.72, "rgba(230, 215, 175, 0.16)");
        grd.addColorStop(1, "rgba(200, 190, 160, 0)");
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(cx, 480, 165, 460, 0, 0, Math.PI * 2);
        g.fill();
      }
    });

    const roadBeam = new THREE.Mesh(
      new THREE.PlaneGeometry(8.2, 52),
      new THREE.MeshBasicMaterial({
        map: beamTex,
        color: 0xfffaea,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    roadBeam.rotation.x = -Math.PI / 2;
    roadBeam.position.set(0, 0.025, -27);
    roadBeam.name = "road-beam";
    roadBeam.visible = false;
    car.add(roadBeam);
    this.roadBeamMesh = roadBeam;

    // Spinning wheels: kept unmerged by the loader, recentred on the hub.
    this.playerWheels.length = 0;
    car.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData["wheel"]) {
        this.playerWheels.push({ mesh: m, radius: m.userData["radius"] || 0.34 });
      }
    });

    this.player = car;
    this.wing = car.getObjectByName("active-wing");
    this.scene.add(car);
  }

  private makeFlame(car: THREE.Group, tip: THREE.Vector3): Flame {
    const g = new THREE.Group();
    g.position.copy(tip);
    const mk = (radius: number, core: number) => {
      const geo = new THREE.CylinderGeometry(
        radius * 0.25,
        radius,
        1,
        this.low ? 10 : 20,
        this.low ? 5 : 12,
        true,
      );
      // base at the tip, flame extends along +Z (backward)
      geo.translate(0, 0.5, 0);
      geo.rotateX(Math.PI / 2);
      // cylinder uv.y runs 0 at bottom (wide base) to 1 at top; after the
      // rotation the base sits at the tip — flip so 0 = tip.
      const mat = new THREE.ShaderMaterial({
        vertexShader: flameVert,
        fragmentShader: flameFrag,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uSeed: { value: Math.random() * 10 },
          uCore: { value: core },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      g.add(mesh);
      return { mesh, mat };
    };
    const outer = mk(0.11, 0);
    const core = mk(0.05, 1);
    core.mesh.scale.set(1, 1, 0.45);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTex([
          [0, "rgba(255,190,110,1)"],
          [0.35, "rgba(255,110,30,0.45)"],
          [1, "rgba(255,60,0,0)"],
        ]),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.scale.setScalar(0.6);
    glow.position.z = 0.15;
    g.add(glow);
    const light = new THREE.PointLight(0xff7a2a, 0, 7, 2);
    light.position.z = 0.4;
    if (!this.low) g.add(light);
    g.visible = false;
    car.add(g);
    return { group: g, outer: outer.mat, core: core.mat, glow, light };
  }

  private trafficBatches = new Map<TrafficKey, THREE.InstancedMesh[]>();
  private trafficSignals = new Map<TrafficKey, THREE.InstancedMesh>();
  /** Moving wing parts per model (Bugatti), drawn with a per-car lift. */
  private trafficWings = new Map<
    TrafficKey,
    { pivot: THREE.Vector3; parts: { mesh: THREE.InstancedMesh; strut: boolean }[] }
  >();
  private wingLift = new WeakMap<object, number>();
  private wingLocal = new THREE.Matrix4();
  private wingWorld = new THREE.Matrix4();
  private wingEuler = new THREE.Euler();
  private wingQuat = new THREE.Quaternion();
  private wingPos = new THREE.Vector3();
  private unitScale = new THREE.Vector3(1, 1, 1);

  /** Mustang GT interceptor: black-and-white livery, light bar, POLÍCIA doors. */
  private setupPolice(car: THREE.Group) {
    car.updateMatrixWorld(true);
    const size = new THREE.Vector3();
    car.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // Body shell = the big panels that span the car; repaint them gloss black.
      new THREE.Box3().setFromObject(m).getSize(size);
      const isShell = size.x > 1.5 && size.z > 3;
      const swap = (mat: THREE.Material) => {
        const n = mat.name.toLowerCase();
        if (!(n === "body" || n.startsWith("palette") || (isShell && n.startsWith("fordm_grille")))) return mat;
        const c = (mat as THREE.MeshStandardMaterial).clone();
        c.map = null;
        c.color.set(0x08090b);
        c.metalness = 0.75;
        c.roughness = 0.2;
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    const box = new THREE.Box3().setFromObject(car);
    const roof = box.max.y;
    const halfW = (box.max.x - box.min.x) / 2;
    // Door panels: white with "POLÍCIA" lettering (one canvas texture for both sides)
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 96;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#f2f2f0";
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = "#0a2a6b";
    g.fillRect(0, 74, 512, 10);
    g.fillStyle = "#101114";
    g.font = "bold 58px Barlow, Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("POLÍCIA", 256, 40);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const doorMat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.3, roughness: 0.35 });
    const door = new THREE.PlaneGeometry(2.0, 0.38);
    for (const side of [-1, 1]) {
      const d = new THREE.Mesh(door, doorMat);
      d.position.set(side * (halfW - 0.03), roof * 0.47, 0.05);
      d.rotation.y = side * (Math.PI / 2);
      car.add(d);
    }
    // Light bar: red (driver side) / blue, flashed from render()
    this.policeRed = new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0xff1010,
      emissiveIntensity: 0,
      toneMapped: false,
    });
    this.policeBlue = new THREE.MeshStandardMaterial({
      color: 0x000833,
      emissive: 0x1a4dff,
      emissiveIntensity: 0,
      toneMapped: false,
    });
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.07, 0.26),
      new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 }),
    );
    base.position.set(0, roof + 0.02, 0.15);
    car.add(base);
    const lamp = new THREE.BoxGeometry(0.52, 0.09, 0.22);
    const red = new THREE.Mesh(lamp, this.policeRed);
    red.position.set(-0.29, roof + 0.09, 0.15);
    const blue = new THREE.Mesh(lamp, this.policeBlue);
    blue.position.set(0.29, roof + 0.09, 0.15);
    car.add(red, blue);
    this.addContactShadow(car, 2.15, 4.9);
    car.visible = false;
    this.scene.add(car);
    this.policeCar = car;
  }

  private setupTrafficBatch(key: TrafficKey, template: THREE.Group) {
    const parts: THREE.InstancedMesh[] = [];
    const wingParts: { mesh: THREE.InstancedMesh; strut: boolean }[] = [];
    let pivot: THREE.Vector3 | null = null;
    template.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of materials) mat.forceSinglePass = true;
      const mesh = new THREE.InstancedMesh(object.geometry, object.material, 128);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      if (object.parent?.name === "active-wing") {
        pivot = object.parent.position.clone();
        wingParts.push({ mesh, strut: !!object.userData["strut"] });
      } else parts.push(mesh);
    });
    if (pivot && wingParts.length) this.trafficWings.set(key, { pivot, parts: wingParts });
    const [fw, fl] = MODEL_FOOTPRINT[key] ?? [2, 4.6];
    const shadow = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(fw + 0.15, fl + 0.2)
        .rotateX(-Math.PI / 2)
        .translate(0, 0.018, 0),
      new THREE.MeshBasicMaterial({
        map: this.contactTex,
        color: 0x000000,
        transparent: true,
        opacity: 0.86,
        depthWrite: false,
      }),
      128,
    );
    shadow.frustumCulled = false;
    this.scene.add(shadow);
    parts.push(shadow);
    this.trafficBatches.set(key, parts);
    const indicators = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.13, 0.08, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xffa000 }),
      256,
    );
    indicators.frustumCulled = false;
    indicators.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(indicators);
    this.trafficSignals.set(key, indicators);
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Switch to the next camera view (chase → hood → left → right → reverse). */
  cycleCamera(): CameraView {
    this.camView = nextCameraView(this.camView);
    this.canvas.dataset["camMode"] = this.camView;
    return this.camView;
  }

  get cameraView(): CameraView {
    return this.camView;
  }

  // ---------- per frame ----------
  render = (s: RenderSnapshot) => {
    const now = performance.now();
    if (
      this.lastFrame &&
      this.low &&
      this.quality.sample((now - this.lastFrame) / 1000, document.hidden)
    ) {
      this.renderer.setPixelRatio(this.baseDpr * this.quality.scale);
      this.renderer.setSize(this.width, this.height, false);
    }
    this.lastFrame = now;
    const dt = Math.min(s.dt, 0.05);
    this.time += dt;
    const { ppm } = s;
    const toX = (x: number) => (x - s.roadCenterX) / ppm;
    const toZ = (y: number) => (y - s.baseY) / ppm;
    const pz = s.pz;

    const night = nightAmount(pz);
    const rain = rainAmount(pz);
    const tunnel = inTunnel(pz);
    const lights = lightsOn(pz) || s.highBeam;

    // --- sky, fog, light levels
    const dusk = Math.min(1, night * 2) * (1 - night);
    this.sky
      .copy(this.dayColor)
      .lerp(this.duskColor, dusk * 0.8)
      .lerp(this.nightColor, night);
    this.sky.lerp(this.rainColor, rain * 0.6 * (1 - night));
    const tunnelBlend = this.tunnelFactor(pz);
    this.scene.background =
      night < 0.05 && rain < 0.05 && tunnelBlend < 0.05 ? this.daySky : this.sky;
    this.fog.color.copy(this.sky).lerp(this.tunnelColor, tunnelBlend);
    this.fog.near = lerp(60, 25, Math.max(rain, night * 0.5));
    this.fog.far = lerp(VIEW_AHEAD - 10, 150, rain);
    this.sun.intensity = lerp(2.9, 0.04, night) * (1 - rain * 0.6) * (1 - tunnelBlend);
    this.hemi.intensity = lerp(0.95, 0.38, night) * (1 - rain * 0.2) * lerp(1, 0.65, tunnelBlend);
    this.scene.environmentIntensity = lerp(1.15, 0.18, night) * lerp(1, 0.35, tunnelBlend);
    if (this.reflectionMaps) this.scene.environment = tunnelBlend > 0.5
      ? this.reflectionMaps.tunnel.texture
      : night > 0.45 ? this.reflectionMaps.night.texture : this.reflectionMaps.day.texture;
    const rimK = lerp(1, 0.3, Math.max(night, tunnelBlend));
    this.rimWarm.intensity = 0.22 * rimK;
    this.rimCool.intensity = 0.32 * rimK;
    this.roadMat.roughness = lerp(0.96, 0.38, rain);
    this.roadMat.color.setScalar(lerp(1, 0.55, rain));
    this.tunnelLamp.intensity = tunnel ? 28 + Math.sin(((pz % 8) / 8) * Math.PI * 2) * 10 : 0;

    const px = s.player.x;
    const playerX = toX(px);
    // --- scrolling ground
    this.roadTex.offset.y = (pz / TILE_LEN) % 1;
    if (this.roadDetail) this.roadDetail.offset.y = (pz / 3.5) % 1;
    this.grassTex.offset.y = (pz / 8) % 1;
    this.layoutScenery(pz, night);
    this.placeLandmarks(pz);

    // --- sun follows the player for crisp shadows
    this.sun.position.set(playerX + 8, 22, -6);
    this.sun.target.position.set(playerX, 0, -8);

    // --- player
    if (this.player) {
      const p = this.player;
      p.position.set(playerX, 0, 0);
      if (this.playerShadow) {
        this.playerShadow.position.x = playerX;
        this.playerShadow.rotation.z = s.player.rot;
      }
      if (this.sunShadow) {
        const o = shadowOffset(pz, tunnel, night);
        this.sunShadow.position.x = playerX + o.x;
        this.sunShadow.position.z = o.z;
        this.sunShadow.rotation.z = s.player.rot;
        (this.sunShadow.material as THREE.MeshBasicMaterial).opacity = o.strength;
      }
      p.rotation.y = -s.player.rot;
      // Realistic suspension body roll strictly clamped (never capsizes or rolls onto its roof)
      p.rotation.z = Math.max(-0.06, Math.min(0.06, s.player.rot * 0.08));
      // Subtle pitch on braking nose dive
      p.rotation.x = s.braking ? -0.025 : 0;
      // Wheels spin with road speed and lock dead while braking (skid).
      for (const w of this.playerWheels) {
        w.mesh.rotation.x -= wheelOmega(s.player.speed, s.braking, w.radius) * dt;
      }
      if (import.meta.env.DEV && this.playerWheels.length) {
        this.canvas.dataset["wheelRot"] = this.playerWheels[0]!.mesh.rotation.x.toFixed(3);
        this.canvas.dataset["wheelCount"] = String(this.playerWheels.length);
      }
      this.aero = stepAero(this.aero, s.player.speed, s.braking, dt);
      if (this.wing) {
        this.wing.position.y = 0.96 + this.aero.lift * 0.17;
        this.wing.rotation.x = this.aero.tilt;
        for (const support of p.children.filter((c) => c.name === "wing-support")) {
          support.visible = this.aero.lift > 0.02;
          support.scale.y = this.aero.lift;
          support.position.y = 0.8 + this.aero.lift * 0.085;
        }
        if (import.meta.env.DEV) {
          this.canvas.dataset["wingLift"] = this.aero.lift.toFixed(3);
          this.canvas.dataset["wingTilt"] = this.aero.tilt.toFixed(3);
        }
      }
      const isBraking = s.braking;
      // Dedicated engine red brake line: turns ON ONLY when braking, disappears when braking stops!
      if (this.engineBrakeLight) {
        this.engineBrakeLight.visible = isBraking;
      }
      for (const m of this.playerBrakeOnly) {
        m.emissiveIntensity = isBraking ? 4 : 0;
      }
      if (import.meta.env.DEV)
        this.canvas.dataset["tail"] = this.playerTail
          .map((m) => `${m.name}:${m.emissive.getHexString()}:${m.emissiveIntensity}:${m.toneMapped}`)
          .join("|") + `|brake=${isBraking}|lights=${lights}`;
      for (const m of this.playerTail) {
        m.emissiveIntensity = isBraking ? 2.6 : lights ? 1.5 : 0.2;
      }
      for (const m of this.playerHead) {
        m.emissiveIntensity = lights ? 3.8 : 0.6;
      }
      for (const { mesh, kind } of this.lightHalos) {
        mesh.material.opacity = kind === "brake" ? (isBraking ? 0.65 : 0)
          : kind === "tail" ? (isBraking ? 0.65 : lights ? 0.44 : 0.035)
          : lights ? 0.35 : 0.015;
        mesh.visible = mesh.material.opacity > 0;
      }
      if (this.roadBeamMesh) {
        this.roadBeamMesh.visible = lights;
        this.roadBeamMesh.material.opacity = s.highBeam ? 0.85 : tunnel ? 0.72 : 0.52;
      }
      for (const child of p.children) if (child.name === "road-beam") child.visible = lights;
      const beam = s.highBeam ? 260 : lights ? 140 : 0;
      this.headL.intensity = this.headR.intensity = beam;
      this.headL.distance = this.headR.distance = s.highBeam ? 160 : 90;
      this.updateFlames(s, dt);
    }

    // Shared material batches: every visible vehicle still draws, with one
    // call per part/material rather than one call per car per part.
    for (const [model, parts] of this.trafficBatches) {
      let count = 0;
      let signalCount = 0;
      const indicators = this.trafficSignals.get(model);
      const wings = this.trafficWings.get(model);
      for (const car of s.traffic) {
        const z = toZ(car.y);
        if (
          TYPE_MODEL[car.type] !== model ||
          z < -TRAFFIC_DRAW_AHEAD ||
          z > VIEW_BEHIND ||
          count >= 128
        )
          continue;
        this.positionVector.set(toX(car.x), 0, z);
        this.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -car.rot);
        this.scaleVector.set(1, 1, 1);
        this.matrix.compose(this.positionVector, this.quaternion, this.scaleVector);
        for (const part of parts) part.setMatrixAt(count, this.matrix);
        if (wings) {
          // Wing up while racing (push / overtake), flush with the tail when cruising.
          const racing = !car.hit && (!!car.sportPush || car.yieldState === "accelerating");
          const lift = stepTrafficWing(this.wingLift.get(car) ?? 0, racing, dt);
          this.wingLift.set(car, lift);
          for (const { mesh, strut } of wings.parts) {
            this.wingPos.copy(wings.pivot);
            this.wingPos.y += lift * TRAFFIC_WING_RISE * (strut ? 0.55 : 1);
            this.wingEuler.set(strut ? 0 : lift * TRAFFIC_WING_TILT, 0, 0);
            this.wingQuat.setFromEuler(this.wingEuler);
            this.wingLocal.compose(this.wingPos, this.wingQuat, this.unitScale);
            this.wingWorld.multiplyMatrices(this.matrix, this.wingLocal);
            mesh.setMatrixAt(count, this.wingWorld);
          }
          if (import.meta.env.DEV && count === 0)
            this.canvas.dataset["bugattiWing"] = lift.toFixed(3);
        }
        if (indicators && car.signal !== 0 && Math.floor(car.signalTimer * 2.6) % 2 === 0) {
          const [cw, cl] = FOOTPRINTS[car.type];
          this.positionVector.set(
            toX(car.x) + car.signal * (cw / 2 - 0.12),
            car.type === "bus" || car.type === "truck" ? 1.1 : 0.82,
            z + cl / 2 + 0.03,
          );
          this.matrix.compose(this.positionVector, this.quaternion, this.scaleVector);
          indicators.setMatrixAt(signalCount++, this.matrix);
        }
        count++;
      }
      for (const part of wings ? [...parts, ...wings.parts.map((w) => w.mesh)] : parts) {
        part.count = count;
        part.visible = count > 0;
        part.instanceMatrix.needsUpdate = true;
      }
      if (indicators) {
        indicators.count = signalCount;
        indicators.visible = signalCount > 0;
        indicators.instanceMatrix.needsUpdate = true;
      }
    }

    if (this.policeCar) {
      const pol = s.police;
      const z = toZ(pol.y);
      const show = s.mode === "police" && pol.active && z > -TRAFFIC_DRAW_AHEAD && z < VIEW_BEHIND;
      this.policeCar.visible = show;
      if (show) {
        this.policeCar.position.set(toX(pol.x), 0, z);
        this.policeCar.rotation.y = -pol.rot;
        // Double-flash pattern alternating red / blue
        const ph = (this.time * 2.2) % 1;
        const flash = (a: number) => (ph > a && ph < a + 0.09) || (ph > a + 0.15 && ph < a + 0.24);
        if (this.policeRed) this.policeRed.emissiveIntensity = flash(0) ? 6 : 0.15;
        if (this.policeBlue) this.policeBlue.emissiveIntensity = flash(0.5) ? 6 : 0.15;
      }
    }

    this.updateParticles(s, toX, toZ);
    this.updateRain(rain, dt, s.player.speed, tunnel);

    // --- chase camera
    this.camX = lerp(this.camX, playerX, 1 - Math.exp(-6 * dt));
    const speedK = Math.min(1, s.player.speed / 340);
    // Pull back a little while accelerating for a sense of speed (no exaggeration)
    const pullTarget = s.gas && s.player.speed < 345 ? (s.boostActive ? 1 : 0.7) : 0;
    this.camPull = lerp(this.camPull, pullTarget, 1 - Math.exp(-(pullTarget > this.camPull ? 1.6 : 2.4) * dt));
    const fov = 60 + speedK * 12;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const sh = s.shake * 0.012;
    const pose = this.camView === "chase" ? null : CAMERA_POSES[this.camView];
    if (!pose) {
      this.camera.position.set(
        this.camX * 0.9 + (Math.random() - 0.5) * sh,
        2.05 - speedK * 0.25 + this.camPull * 0.14 + (Math.random() - 0.5) * sh,
        6.6 - speedK * 0.8 + this.camPull * 0.75,
      );
      this.camera.lookAt(this.camX * 0.95, 0.85, -16);
    } else {
      // Fixed views (hood / sides / reverse) keep a steady framing; the whole
      // world around the car stays rendered, so nothing pops in while looking back.
      const fixed = sh * 0.5;
      this.camera.position.set(
        this.camX + pose.pos.dx + (Math.random() - 0.5) * fixed,
        pose.pos.y + (Math.random() - 0.5) * fixed,
        pose.pos.z,
      );
      this.camera.lookAt(this.camX + pose.look.dx, pose.look.y, pose.look.z);
    }

    // flash / police danger overlay
    if (this.overlay) {
      this.overlay.style.opacity = String(Math.min(0.6, s.flash * 0.6));
    }

    this.renderer.render(this.scene, this.camera);
    if (import.meta.env.DEV) {
      this.canvas.dataset["drawCalls"] = String(this.renderer.info.render.calls);
      this.canvas.dataset["triangles"] = String(this.renderer.info.render.triangles);
      this.canvas.dataset["quality"] =
        `${this.low ? "mobile" : "standard"}:${this.quality.scale.toFixed(2)}`;
    }
    if (!this.ready && this.player && this.canvas.dataset["modelsReady"] === "true") {
      this.ready = true;
      this.onReady?.();
    }
  };

  /** 0 outside, 1 deep in the tunnel; ramps over the first/last 25 m. */
  private tunnelFactor(pz: number) {
    const u = cyc(pz);
    if (u < TUNNEL_FROM - 5 || u > TUNNEL_TO + 5) return 0;
    const a = Math.min(1, (u - TUNNEL_FROM + 5) / 25);
    const b = Math.min(1, (TUNNEL_TO + 5 - u) / 25);
    return Math.max(0, Math.min(a, b));
  }

  private nearest(pz: number, at: number) {
    // world z of the nearest occurrence of cycle position `at` (ahead or just behind)
    const base = pz - cyc(pz);
    let z = base + at;
    if (z < pz - VIEW_BEHIND - 40) z += CYCLE;
    return -(z - pz);
  }

  private placeLandmarks(pz: number) {
    // tunnel
    const len = TUNNEL_TO - TUNNEL_FROM;
    const base = pz - cyc(pz);
    let start = base + TUNNEL_FROM;
    if (start + len < pz - VIEW_BEHIND) start += CYCLE;
    const tz = -(start - pz);
    this.tunnel.position.z = tz;
    this.tunnel.visible = tz > -VIEW_AHEAD - 10 && tz - len < VIEW_BEHIND;

    const placeSet = (objs: THREE.Group[], positions: number[]) => {
      const zs = positions
        .map((p) => this.nearest(pz, p))
        .filter((z) => z > -VIEW_AHEAD && z < VIEW_BEHIND)
        .sort((a, b) => b - a);
      objs.forEach((o, i) => {
        const z = zs[i];
        o.visible = z !== undefined;
        if (z !== undefined) o.position.z = z;
      });
    };
    placeSet(
      this.bridges,
      BRIDGES.map(([a, b]) => (a + b) / 2),
    );
    placeSet(this.gantries, SIGN_GANTRIES);
    placeSet(this.radars, SPEED_RADARS);
  }

  private layoutScenery(pz: number, night: number) {
    const m = this.matrix;
    const q = this.quaternion;
    const sc = this.scaleVector;
    const pos = this.positionVector;
    const tunnelAt = (z: number) => inTunnel(z);

    if (this.buildings && this.rooftops) {
      let count = 0;
      for (
        let n = Math.floor((pz - VIEW_BEHIND) / 28);
        n * 28 < pz + VIEW_AHEAD + 90 && count < 72;
        n++
      ) {
        for (const side of [-1, 1]) {
          const z = n * 28;
          if (tunnelAt(z)) continue;
          const h = hash(n * 13 + side),
            height = 12 + hash(n * 5 + side) * 42;
          const x = side * (42 + h * 48),
            width = 12 + hash(n * 7) * 9,
            depth = 12 + hash(n * 8) * 12;
          pos.set(x, 0, -(z - pz));
          sc.set(width, height, depth);
          q.identity();
          m.compose(pos, q, sc);
          this.buildings.setMatrixAt(count, m);
          pos.set(x, height + 0.4, -(z - pz));
          sc.set(width + 0.4, 0.8, depth + 0.4);
          m.compose(pos, q, sc);
          this.rooftops.setMatrixAt(count, m);
          count++;
        }
      }
      this.buildings.count = this.rooftops.count = count;
      this.buildings.instanceMatrix.needsUpdate = this.rooftops.instanceMatrix.needsUpdate = true;
      if (this.cityMaterial) this.cityMaterial.emissiveIntensity = night * 0.55;
    }

    // guardrail posts every 4 m
    let i = 0;
    const first = Math.floor((pz - VIEW_BEHIND) / 4);
    for (let n = first; i < 159; n++) {
      const z = n * 4;
      if (z > pz + 160) break;
      for (const s of [-1, 1]) {
        m.makeTranslation(s * (DECK_W / 2 + 0.55), 0, -(z - pz));
        this.posts.setMatrixAt(i++, m);
      }
    }
    this.posts.count = i;
    this.posts.instanceMatrix.needsUpdate = true;

    // trees: one slot every 7 m per side, skipped in tunnels
    i = 0;
    const tFirst = Math.floor((pz - VIEW_BEHIND) / 7);
    for (let n = tFirst; i < 139; n++) {
      const z = n * 7;
      if (z > pz + (this.low ? 120 : VIEW_AHEAD)) break;
      for (const s of [-1, 1]) {
        const hsh = hash(n * 2 + (s > 0 ? 1 : 0));
        if (hsh < 0.25 || tunnelAt(z)) continue;
        const x = s * (DECK_W / 2 + 6 + hsh * 26);
        const k = 0.7 + hash(n * 7.3 + s) * 0.9;
        pos.set(x, 0, -(z - pz));
        sc.set(k, k * (0.9 + hsh * 0.5), k);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hsh * 6);
        m.compose(pos, q, sc);
        this.trunks.setMatrixAt(i, m);
        this.crowns.setMatrixAt(i, m);
        i++;
      }
    }
    this.trunks.count = this.crowns.count = i;
    this.trunks.instanceMatrix.needsUpdate = this.crowns.instanceMatrix.needsUpdate = true;

    // street lamps every 45 m alternating sides
    i = 0;
    const lFirst = Math.floor((pz - VIEW_BEHIND) / 45);
    for (let n = lFirst; i < 24; n++) {
      const z = n * 45;
      if (z > pz + (this.low ? 120 : VIEW_AHEAD)) break;
      if (tunnelAt(z)) continue;
      const s = n % 2 === 0 ? -1 : 1;
      const x = s * (DECK_W / 2 + 1.4);
      pos.set(x, 0, -(z - pz));
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, 0);
      sc.set(1, 1, 1);
      m.compose(pos, q, sc);
      this.lampPoles.setMatrixAt(i, m);
      m.makeTranslation(x - s * 0.8, 0, -(z - pz));
      this.lampHeads.setMatrixAt(i, m);
      m.makeTranslation(x - s * 3.2, 0, -(z - pz));
      this.lampPools.setMatrixAt(i, m);
      i++;
    }
    this.lampPoles.count = this.lampHeads.count = this.lampPools.count = i;
    this.lampPoles.instanceMatrix.needsUpdate =
      this.lampHeads.instanceMatrix.needsUpdate =
      this.lampPools.instanceMatrix.needsUpdate =
        true;
    const lampOn = Math.max(0, (night - 0.25) / 0.75);
    this.lampHeadMat.emissiveIntensity = lampOn * 4;
    this.lampPoolMat.opacity = lampOn * 0.55;
  }

  private updateFlames(s: RenderSnapshot, dt: number) {
    // Shift pops (timer) and sustained boost give the big jet; lifting off at
    // high rpm gives short random crackles.
    let target = 0;
    let len = 0;
    if (s.boostActive) {
      target = 1;
      len = 1.05 + Math.random() * 0.45;
    } else if (s.exhaustFlame > 0) {
      target = Math.min(1, s.exhaustFlame / 0.18);
      len = 0.9 + Math.random() * 0.7;
    } else if (!s.gas && s.player.speed > 120 && s.phase === "playing") {
      this.popT -= dt;
      if (this.popT <= 0) {
        this.popT = 0.08 + Math.random() * 0.35;
        if (Math.random() < 0.45) {
          target = 0.55;
          len = 0.3 + Math.random() * 0.3;
        }
      }
    }
    this.flameAmt = target > this.flameAmt ? target : this.flameAmt * Math.exp(-14 * dt);
    this.flameLen = len > 0 ? len : this.flameLen * Math.exp(-8 * dt);
    const on = this.flameAmt > 0.02;
    for (const f of this.flames) {
      f.group.visible = on;
      if (!on) continue;
      const flick = 0.75 + Math.random() * 0.5;
      const L = Math.max(0.12, this.flameLen * flick);
      f.group.scale.set(1 + this.flameAmt * 0.3, 1 + this.flameAmt * 0.3, L);
      // keep the glow sprite round despite the group's z stretch
      f.glow.scale.set(0.55 * flick, 0.55 * flick, 0.55 / L);
      for (const mat of [f.outer, f.core]) {
        const time = mat.uniforms["uTime"];
        const intensity = mat.uniforms["uIntensity"];
        if (time) time.value = this.time;
        if (intensity) intensity.value = this.flameAmt * flick * 1.4;
      }
      f.light.intensity = this.flameAmt * flick * 14;
    }
  }

  private updateParticles(
    s: RenderSnapshot,
    toX: (x: number) => number,
    toZ: (y: number) => number,
  ) {
    let i = 0;
    for (const q of s.particles) {
      if (i >= this.sprites.length) break;
      if (q.kind === "flame") continue; // drawn by the 3D exhaust flames
      const sp = this.sprites[i++];
      if (!sp) break;
      const mat = sp.material;
      const life = q.life / q.max;
      sp.visible = true;
      sp.position.set(
        toX(q.x),
        q.kind === "rubber"
          ? (q.h ?? 0.02)
          : 0.4 + (q.kind === "smoke" ? life * 2.4 : q.kind === "spark" ? 0.4 : 0.15),
        toZ(q.y),
      );
      const size = (q.size / s.ppm) * (q.kind === "smoke" ? 2.2 : q.kind === "spark" ? 3 : 1.6);
      sp.scale.setScalar(Math.max(0.05, size));
      if (q.kind === "spark") {
        mat.map = this.sparkTex;
        mat.blending = THREE.AdditiveBlending;
        mat.color.setHex(0xffffff);
      } else {
        mat.map = this.smokeTex;
        mat.blending = THREE.NormalBlending;
        mat.color.setHex(
          q.kind === "spray"
            ? 0xd5dde6
            : q.dark
              ? 0x2a2a2c
              : q.kind === "debris" || q.kind === "rubber"
                ? 0x111111
                : 0x9a9a9e,
        );
      }
      mat.opacity = q.kind === "rubber" ? q.alpha * Math.min(1, (1 - life) * 3) : q.alpha * (1 - life);
    }
    for (; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      if (sprite) sprite.visible = false;
    }
  }

  private updateRain(rain: number, dt: number, speed: number, tunnel: boolean) {
    const mat = this.rain.material as THREE.LineBasicMaterial;
    mat.opacity = tunnel ? 0 : rain * 0.55;
    this.rain.visible = mat.opacity > 0.01;
    if (!this.rain.visible) return;
    this.rain.position.x = this.camX;
    const fall = 22 * dt;
    const rush = (speed / 3.6) * dt;
    const a = this.rainPos;
    for (let i = 0; i < a.length / 6; i++) {
      const o = i * 6;
      a[o + 1] = (a[o + 1] ?? 0) - fall;
      a[o + 4] = (a[o + 4] ?? 0) - fall;
      a[o + 2] = (a[o + 2] ?? 0) + rush;
      a[o + 5] = (a[o + 5] ?? 0) + rush;
      if ((a[o + 1] ?? 0) < 0 || (a[o + 2] ?? 0) > 10) this.resetDrop(i, false);
    }
    (this.rain.geometry.attributes["position"] as THREE.BufferAttribute).needsUpdate = true;
  }

  private addContactShadow(car: THREE.Object3D, width: number, length: number) {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshBasicMaterial({
        map: this.contactTex,
        color: 0x000000,
        transparent: true,
        opacity: 0.86,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.018;
    car.add(shadow);
    return shadow;
  }

  dispose() {
    this.disposed = true;
    this.reflectionMaps?.day.dispose();
    this.reflectionMaps?.night.dispose();
    this.reflectionMaps?.tunnel.dispose();
    this.reflectionMaps?.asphalt.dispose();
    this.roadDetail?.dispose();
    this.daySky.dispose();
    this.contactTex.dispose();
    this.roadTex.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
  }
}
