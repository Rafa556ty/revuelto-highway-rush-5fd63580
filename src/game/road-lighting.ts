import * as THREE from "three";
import skyUrl from "@/assets/highway-sky.jpg";
import asphaltUrl from "@/assets/highway-asphalt.jpg";

/** One-time baked IBL, never a live cube-camera or phone post-processing pass. */
export async function loadRoadLighting(renderer: THREE.WebGLRenderer) {
  const loader = new THREE.TextureLoader();
  const [sky, asphalt] = await Promise.all([loader.loadAsync(skyUrl), loader.loadAsync(asphaltUrl)]);
  sky.colorSpace = asphalt.colorSpace = THREE.SRGBColorSpace;
  sky.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const day = pmrem.fromEquirectangular(sky);
  const panorama = (tunnel: boolean) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Reflection canvas unavailable");
    const gradient = g.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, tunnel ? "#292724" : "#101c30");
    gradient.addColorStop(0.5, tunnel ? "#4a4236" : "#344255");
    gradient.addColorStop(0.65, "#17191c");
    gradient.addColorStop(1, "#080a0d");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 512, 256);
    if (tunnel) {
      g.fillStyle = "#e6c69d";
      for (let x = 20; x < 512; x += 64) g.fillRect(x, 55, 28, 6);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const target = pmrem.fromEquirectangular(texture);
    texture.dispose();
    return target;
  };
  const night = panorama(false);
  const tunnel = panorama(true);
  pmrem.dispose();
  return { sky, asphalt, day, night, tunnel };
}

/** Rectangular chassis occlusion with tight tyre contact baked into one draw. */
export function contactTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Contact canvas unavailable");
  const image = g.createImageData(128, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) {
    const nx = (x - 64) / 64, ny = (y - 128) / 128;
    const body = Math.exp(-3.4 * (Math.pow(nx / 0.82, 4) + Math.pow(ny / 0.82, 4)));
    let tyre = 0;
    for (const sx of [-0.77, 0.77]) for (const sy of [-0.62, 0.62]) {
      tyre += Math.exp(-((nx - sx) ** 2 / 0.022 + (ny - sy) ** 2 / 0.015));
    }
    image.data[(y * 128 + x) * 4 + 3] = Math.min(230, body * 170 + tyre * 150);
  }
  g.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}