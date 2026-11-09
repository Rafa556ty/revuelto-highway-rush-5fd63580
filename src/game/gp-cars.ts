// GP mode car roster (pure data + rules, no three.js / React).

export type GpCarId =
  | "bmw-m3-gtr"
  | "revuelto"
  | "porsche-gt3"
  | "ferrari-sf90"
  | "bugatti-chiron"
  | "mustang-gt";

export type GpCar = {
  id: GpCarId;
  brand: string;
  name: string;
  year: string;
  engine: string;
  power: string;
  available: boolean;
  /** 3D model served from public/game-assets (only for available cars). */
  model?: { url: string; length: number; yaw: number };
};

export const GP_CARS: readonly GpCar[] = [
  {
    id: "bmw-m3-gtr",
    brand: "BMW",
    name: "M3 GTR",
    year: "2001",
    engine: "V8 4.0",
    power: "450 cv",
    available: true,
    model: { url: "/game-assets/bmw-m3-gtr.glb", length: 4.55, yaw: 0 },
  },
  { id: "revuelto", brand: "LAMBORGHINI", name: "REVUELTO", year: "2024", engine: "V12 HÍBRIDO", power: "1015 cv", available: false },
  { id: "porsche-gt3", brand: "PORSCHE", name: "911 GT3", year: "2022", engine: "FLAT-6 4.0", power: "510 cv", available: false },
  { id: "ferrari-sf90", brand: "FERRARI", name: "SF90", year: "2020", engine: "V8 HÍBRIDO", power: "1000 cv", available: false },
  { id: "bugatti-chiron", brand: "BUGATTI", name: "CHIRON", year: "2017", engine: "W16 8.0", power: "1500 cv", available: false },
  { id: "mustang-gt", brand: "FORD", name: "MUSTANG GT", year: "2020", engine: "V8 5.0", power: "460 cv", available: false },
];

export function getGpCar(id: GpCarId): GpCar | undefined {
  return GP_CARS.find((c) => c.id === id);
}

/** Only unlocked cars with a model can be taken to the pit. */
export function canSelectGpCar(id: GpCarId): boolean {
  const car = getGpCar(id);
  return !!car && car.available && !!car.model;
}

/** GP modes: only offline practice is open in the demo. */
export type GpModeId = "practice" | "championship";
export function isGpModeOpen(mode: GpModeId): boolean {
  return mode === "practice";
}
