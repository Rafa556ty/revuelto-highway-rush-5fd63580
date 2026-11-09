import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Volume2,
  VolumeX,
  Volume1,
  Palette,
  Settings,
  ShieldAlert,
  Zap,
  Globe,
  X,
  Trophy,
  Flame,
  SunMedium,
  Car,
  Camera,
  Pause,
  Play,
  ShoppingBag,
} from "lucide-react";

import revueltoImg from "@/assets/revuelto.png";
import policeImg from "@/assets/police-gt3rs.png";
import busImg from "@/assets/traffic-bus.png";
import suvImg from "@/assets/traffic-suv.png";
import m5Img from "@/assets/traffic-m5.png";
import mustangBlueImg from "@/assets/traffic-mustang-blue.png";
import mustangBlackImg from "@/assets/traffic-mustang-black.png";
import sedanImg from "@/assets/traffic-sedan.png";
import hatchImg from "@/assets/traffic-hatch.png";
import pickupImg from "@/assets/traffic-pickup.png";
import bullEmblem from "@/assets/bull-emblem.png";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GpMode } from "@/components/GpMode";
import { gpText } from "@/lib/gp-i18n";
import { GameAudio } from "@/game/audio";
import {
  MAX_SPEED,
  RacingEngine,
  loadImage,
  type CarAssetMap,
  type GameOverOutcome,
  type GameInput,
  type HudData,
} from "@/game/engine";
import { LANGUAGES, TRANSLATIONS, getSavedLanguage, saveLanguage, type Language } from "@/lib/i18n";
import type { CameraView } from "@/game/camera-views";
import { detectUi, resolveUi, type UiMode, type UiPref } from "@/game/device-ui";

type Key = keyof GameInput;
type Phase = "loading" | "menu" | "playing" | "over";

const BEST_FREE_KEY = "revuelto-best-distance";
const BEST_POLICE_KEY = "revuelto-police-best-distance";
const CONTROLS_H = 176;

const formatKm = (m: number) => (m / 1000).toFixed(2);

const triggerHaptic = (pattern: number | number[]) => {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Vibration may be blocked by permissions or unsupported
  }
};

export function RacingGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RacingEngine | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const scene3dRef = useRef<import("@/game/render3d").Scene3D | null>(null);

  const pointers = useRef<Record<Key, Set<number>>>({
    left: new Set(),
    right: new Set(),
    gas: new Set(),
    brake: new Set(),
    horn: new Set(),
    boost: new Set(),
    highBeam: new Set(),
  });
  const keys = useRef<GameInput>({
    left: false,
    right: false,
    gas: false,
    brake: false,
    horn: false,
    boost: false,
    highBeam: false,
  });

  const [phase, setPhase] = useState<Phase>("loading");
  const [mode, setMode] = useState<"free" | "police">("free");
  const [hud, setHud] = useState<HudData>({
    speed: 0,
    distance: 0,
    topSpeed: 0,
    gear: 1,
    inTunnel: false,
    nightAmount: 0,
    rainAmount: 0,
    boostEnergy: 100,
    boostActive: false,
    nearMissCombo: 0,
  });
  const [active, setActive] = useState<GameInput>({
    left: false,
    right: false,
    gas: false,
    brake: false,
    horn: false,
    boost: false,
    highBeam: false,
  });
  const [bestFree, setBestFree] = useState(0);
  const [bestPolice, setBestPolice] = useState(0);
  const [result, setResult] = useState<{
    distance: number;
    topSpeed: number;
    record: boolean;
    outcome: GameOverOutcome;
  } | null>(null);
  const [muted, setMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [camView, setCamView] = useState<CameraView>("chase");

  const cycleCamera = useCallback(() => {
    const next = scene3dRef.current?.cycleCamera();
    if (next) {
      setCamView(next);
      triggerHaptic(10);
    }
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      if (engineRef.current) {
        engineRef.current.paused = next;
      }
      return next;
    });
  }, []);

  // i18n & Dialog states
  const [lang, setLang] = useState<Language>("pt-BR");
  const [showFirstLangModal, setShowFirstLangModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [showGp, setShowGp] = useState(false);
  const [showPoliceOff, setShowPoliceOff] = useState(false);
  const [uiPref, setUiPref] = useState<UiPref>("auto");
  const [detectedUi, setDetectedUi] = useState<UiMode>("touch");
  const uiMode = resolveUi(uiPref, detectedUi);
  const isPc = uiMode === "pc";
  useEffect(() => {
    const saved = localStorage.getItem("ui-pref");
    if (saved === "pc" || saved === "touch" || saved === "auto") setUiPref(saved);
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () =>
      setDetectedUi(
        detectUi({
          touchPoints: navigator.maxTouchPoints || 0,
          coarse: coarse.matches,
          width: window.innerWidth,
        }),
      );
    update();
    window.addEventListener("resize", update);
    coarse.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      coarse.removeEventListener("change", update);
    };
  }, []);
  const chooseUi = (p: UiPref) => {
    setUiPref(p);
    localStorage.setItem("ui-pref", p);
  };
  useEffect(() => {
    const engine = engineRef.current;
    const el = containerRef.current;
    if (!engine || !el) return;
    engine.setBottomInset(isPc ? 0 : CONTROLS_H);
    engine.resize(el.clientWidth, el.clientHeight);
  }, [isPc, phase]);

  const t = TRANSLATIONS[lang] || TRANSLATIONS["pt-BR"];

  // Initialize Language (Requirement 10: first time prompt)
  useEffect(() => {
    const saved = getSavedLanguage();
    if (saved) {
      setLang(saved);
    } else {
      setShowFirstLangModal(true);
    }
  }, []);

  const selectLanguage = (newLang: Language) => {
    setLang(newLang);
    saveLanguage(newLang);
    setShowFirstLangModal(false);
    setShowSettingsModal(false);
  };

  const sync = useCallback((key: Key) => {
    const on = (pointers.current[key]?.size ?? 0) > 0 || !!keys.current[key];
    const eng = engineRef.current;
    if (eng) eng.input[key] = on;
    setActive((a) => (a[key] === on ? a : { ...a, [key]: on }));
  }, []);

  // Engine Lifecycle & Multi-car Asset Loading
  useEffect(() => {
    let disposed = false;
    const savedFree = Number(localStorage.getItem(BEST_FREE_KEY) || 0);
    const savedPolice = Number(localStorage.getItem(BEST_POLICE_KEY) || 0);
    setBestFree(savedFree);
    setBestPolice(savedPolice);

    const audio = new GameAudio();
    audioRef.current = audio;

    let ro: ResizeObserver | null = null;
    let scene3d: import("@/game/render3d").Scene3D | null = null;

    Promise.all([
      loadImage(revueltoImg),
      loadImage(policeImg),
      loadImage(busImg),
      loadImage(suvImg),
      loadImage(m5Img),
      loadImage(mustangBlueImg),
      loadImage(mustangBlackImg),
      loadImage(sedanImg),
      loadImage(hatchImg),
      loadImage(pickupImg),
    ])
      .then(([player, police, bus, suv, m5, mustangBlue, mustangBlack, sedan, hatch, pickup]) => {
        if (disposed || !canvasRef.current || !containerRef.current) return;

        const carAssets: CarAssetMap = {
          player,
          police,
          bus,
          suv,
          m5,
          mustangBlue,
          mustangBlack,
          sedan,
          hatch,
          pickup,
        };

        const engine = new RacingEngine(
          canvasRef.current,
          carAssets,
          {
            onHud: setHud,
            onGameOver: ({ distance, topSpeed, outcome }) => {
              const currentMode = engine.mode;
              const bestKey = currentMode === "police" ? BEST_POLICE_KEY : BEST_FREE_KEY;
              const prev = Number(localStorage.getItem(bestKey) || 0);
              const record = distance > prev;
              if (record) {
                localStorage.setItem(bestKey, String(Math.round(distance)));
                if (currentMode === "police") setBestPolice(distance);
                else setBestFree(distance);
              }
              setResult({ distance, topSpeed, record, outcome });
              setPhase("over");
            },
          },
          audio,
        );

        engineRef.current = engine;
        if (import.meta.env.DEV) {
          (window as Window & { __game?: unknown }).__game = {
            get state() {
              return engine.snapshot(0);
            },
            sim: (seconds: number) => engine.debugSim(seconds),
            input: engine.input,
            engine,
            setZ: (z: number) => {
              (engine as unknown as { pz: number }).pz = z;
            },
          };
        }
        engine.setThreeD(true);
        engine.setBottomInset(CONTROLS_H);
        const el = containerRef.current;
        engine.resize(el.clientWidth, el.clientHeight);

        // 3D renderer draws the engine's state every frame.
        void import("@/game/render3d").then(({ Scene3D }) => {
          if (disposed || !canvas3dRef.current) return;
          const scene = new Scene3D(canvas3dRef.current, flashRef.current, () => {
            el.dataset["sceneReady"] = "true";
          });
          scene3d = scene;
          scene3dRef.current = scene;
          scene.resize(el.clientWidth, el.clientHeight);
          engine.onRender = scene.render;
        });

        ro = new ResizeObserver(() => {
          engine.resize(el.clientWidth, el.clientHeight);
          scene3d?.resize(el.clientWidth, el.clientHeight);
        });
        ro.observe(el);

        engine.run();
        setPhase("menu");
      })
      .catch((err) => {
        console.error("Asset load failure:", err);
      });

    return () => {
      disposed = true;
      ro?.disconnect();
      engineRef.current?.stop();
      engineRef.current = null;
      if (import.meta.env.DEV) delete (window as Window & { __game?: unknown }).__game;
      scene3dRef.current = null;
      scene3d?.dispose();
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  // Keyboard controls
  useEffect(() => {
    const map: Record<string, Key> = {
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyD: "right",
      ArrowUp: "gas",
      KeyW: "gas",
      ArrowDown: "brake",
      KeyS: "brake",
      Space: "brake",
      KeyH: "horn",
      KeyB: "horn",
    };

    const handle = (down: boolean) => (e: KeyboardEvent) => {
      if (down && (e.code === "Escape" || e.code === "KeyP")) {
        if (phase === "playing") {
          e.preventDefault();
          togglePause();
          return;
        }
      }
      if (down && e.code === "KeyC") {
        if (phase === "playing") {
          e.preventDefault();
          cycleCamera();
        }
        return;
      }
      const k = map[e.code];
      if (!k) return;
      e.preventDefault();
      keys.current[k] = down;
      sync(k);
    };

    const kd = handle(true);
    const ku = handle(false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [sync, phase, togglePause, cycleCamera]);

  const startGame = (chosenMode?: "free" | "police") => {
    const selected = chosenMode ?? mode;
    audioRef.current?.unlock();
    audioRef.current?.rev();
    setResult(null);
    setIsPaused(false);

    (Object.keys(pointers.current) as Key[]).forEach((k) => {
      pointers.current[k]?.clear();
      sync(k);
    });

    if (engineRef.current) {
      engineRef.current.paused = false;
      engineRef.current.setMode(selected);
      engineRef.current.start();
    }
    setPhase("playing");
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    audioRef.current?.setMuted(m);
  };

  const press = (key: Key) => {
    const release = (e: RPointerEvent<HTMLElement>) => {
      if (pointers.current[key]?.delete(e.pointerId)) sync(key);
    };
    return {
      onPointerDown: (e: RPointerEvent<HTMLElement>) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Some phones reject capture; the press must still register.
        }
        pointers.current[key]?.add(e.pointerId);
        sync(key);
      },
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: release,
      onContextMenu: (e: RMouseEvent) => e.preventDefault(),
    };
  };

  const playing = phase === "playing";
  const speedPct = Math.min(1, hud.speed / MAX_SPEED);
  const bestScore = mode === "police" ? bestPolice : bestFree;

  // Police zone color and label
  const policeZoneConfig = {
    green: { color: "text-emerald-400", bg: "bg-emerald-500", label: t.policeSafe },
    yellow: { color: "text-yellow-400", bg: "bg-yellow-500", label: t.policeWarn },
    orange: { color: "text-orange-400", bg: "bg-orange-500", label: t.policeClose },
    red: { color: "text-rose-500", bg: "bg-rose-500 animate-pulse", label: t.policeDanger },
  };

  const zoneInfo =
    hud.policeZone && policeZoneConfig[hud.policeZone]
      ? policeZoneConfig[hud.policeZone]
      : policeZoneConfig.green;

  const camLabels: Record<CameraView, string> = {
    chase: t.camChase,
    hood: t.camHood,
    left: t.camLeft,
    right: t.camRight,
    reverse: t.camReverse,
  };

  return (
    <main
      className="game-surface fixed inset-0 flex justify-center bg-background"
      onPointerDown={() => audioRef.current?.unlock()}
    >
      <div
        ref={containerRef}
        className={cn(
          "relative h-full w-full overflow-hidden select-none",
          isPc ? "max-w-none" : "max-w-[500px]",
        )}
      >
        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={canvas3dRef} className="absolute inset-0 block h-full w-full touch-none" />
        <div
          ref={flashRef}
          className="pointer-events-none absolute inset-0 bg-foreground opacity-0"
        />

        {/* HUD - Top Bar */}
        {(playing || phase === "over") && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-scrim-top px-3 pb-8 pt-[max(env(safe-area-inset-top),10px)]">
            <div className="flex items-start justify-between gap-2">
              {/* Speedometer & Gear display */}
              <div className="corner-cut border border-hud-border bg-hud px-3.5 py-1.5 shadow-md">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-4xl sm:text-5xl leading-none tabular-nums text-foreground">
                    {Math.round(hud.speed)}
                  </span>
                  <span className="font-display text-base tracking-widest text-primary">KM/H</span>

                  {/* Real-time Gear Indicator (Requirement 12) */}
                  <div className="ml-1 flex items-center gap-1 rounded bg-secondary/80 px-2 py-0.5 border border-hud-border">
                    <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
                      {t.gear}
                    </span>
                    <span className="font-display text-xl font-bold leading-none text-primary">
                      {hud.gear}
                    </span>
                  </div>
                </div>

                {/* Speed progress bar */}
                <div className="mt-1.5 h-1 w-28 sm:w-32 bg-secondary/60 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-[width] duration-100",
                      speedPct > 0.85 ? "bg-brake" : "bg-primary",
                    )}
                    style={{ width: `${speedPct * 100}%` }}
                  />
                </div>
              </div>

              {/* Distance, Record & Audio Mute */}
              <div className="flex items-start gap-2">
                <div className="corner-cut border border-hud-border bg-hud px-3 py-1.5 text-right shadow-md">
                  <div className="font-display text-2xl sm:text-3xl leading-none tabular-nums text-foreground">
                    {formatKm(hud.distance)}
                    <span className="ml-1 text-sm text-primary">KM</span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.record}: {formatKm(bestScore)} km
                  </div>
                </div>

                <Button
                  variant="hud"
                  size="icon"
                  className="pointer-events-auto h-10 w-10 border border-hud-border bg-hud text-foreground hover:bg-secondary/70 shadow-md"
                  onClick={togglePause}
                  aria-label={isPaused ? "Continuar" : "Pausar"}
                >
                  {isPaused ? (
                    <Play className="size-5 text-primary" />
                  ) : (
                    <Pause className="size-5" />
                  )}
                </Button>

                <Button
                  variant="hud"
                  size="icon"
                  className="pointer-events-auto h-10 w-10 border border-hud-border bg-hud text-foreground hover:bg-secondary/70 shadow-md"
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                >
                  {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                </Button>
              </div>
            </div>

            {/* Police Pursuit Minimalist Status Gauge (Requirement 6) */}
            {mode === "police" && hud.policeGap !== undefined && (
              <div className="mt-2.5 mx-auto max-w-[320px] corner-cut border border-hud-border bg-hud/90 px-3 py-1.5 shadow-lg">
                <div className="flex items-center justify-between text-[11px] font-bold tracking-wider">
                  <div className="flex items-center gap-1.5 text-foreground">
                    <ShieldAlert className="size-3.5 text-rose-500 animate-pulse" />
                    <span>{t.policeStatus}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-xs font-display tracking-wider", zoneInfo.color)}>
                      {zoneInfo.label}
                    </span>
                    <span className="tabular-nums text-[10px] text-muted-foreground">
                      ({Math.round(hud.policeGap)}m)
                    </span>
                  </div>
                </div>

                {/* Gap distance indicator bar */}
                <div className="mt-1 h-1.5 w-full bg-secondary/80 rounded-full overflow-hidden flex">
                  <div
                    className={cn("h-full transition-all duration-150", zoneInfo.bg)}
                    style={{
                      width: `${Math.min(100, Math.max(6, (hud.escapeProgress ?? 0) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Near-miss event popup with energetic badge and combo */}
            {playing && hud.nearMissEvent && (
              <div className="mt-2 flex justify-center animate-rise-in pointer-events-none">
                <div className="corner-cut flex items-center gap-2.5 border-2 border-primary/70 bg-black/85 backdrop-blur-xs px-4 py-1.5 shadow-glow">
                  <Flame className="size-5 text-primary animate-pulse" />
                  <div className="flex flex-col items-center">
                    <span className="font-display text-2xl tracking-wider text-primary drop-shadow-md leading-none">
                      {t.nearMiss}!{" "}
                      {hud.nearMissEvent.combo > 1 ? `x${hud.nearMissEvent.combo}` : ""}
                    </span>
                    <span className="text-[10px] font-bold text-foreground/90 tracking-widest uppercase">
                      +{hud.nearMissEvent.pts} PTS • NITRO +20%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Touch Controls Layer */}
        {playing && (
          <div className="absolute inset-0 z-10 pointer-events-none">
            {/* Steering Left / Right Side Touch Areas */}
            {!isPc && (["left", "right"] as const).map((side) => (
              <div
                key={side}
                {...press(side)}
                aria-label={side === "left" ? "Steer Left" : "Steer Right"}
                role="button"
                className={cn(
                  "pointer-events-auto absolute bottom-0 top-[22%] flex w-[26%] items-center transition-colors duration-100 cursor-pointer",
                  side === "left" ? "left-0 justify-start pl-2" : "right-0 justify-end pr-2",
                  active[side] ? "bg-steer-active" : "bg-transparent",
                )}
              >
                <div
                  className={cn(
                    "flex h-16 w-16 items-center justify-center rounded-full bg-black/20 backdrop-blur-xs transition-transform border border-white/10",
                    active[side]
                      ? "scale-110 text-primary border-primary/50"
                      : "text-foreground/75",
                  )}
                >
                  {side === "left" ? (
                    <ChevronLeft className="h-12 w-12" strokeWidth={2.5} />
                  ) : (
                    <ChevronRight className="h-12 w-12" strokeWidth={2.5} />
                  )}
                </div>
              </div>
            ))}

            {/* Bottom Controls: Pedals + Ergonomic Horn Button (Requirement 2) */}
            <div
              className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col items-center justify-end px-4 pb-[max(env(safe-area-inset-bottom),14px)]"
              style={{ height: isPc ? "auto" : CONTROLS_H }}
            >
              {/* Dedicated Ergonomic Horn Button ("BUZINA") + Camera view switch */}
              <div className="mb-2 flex w-full items-center justify-center gap-3">
                <button
                  type="button"
                  {...press("horn")}
                  aria-label={t.horn}
                  className={cn(
                    "corner-cut flex items-center justify-center gap-2 px-6 py-2 border border-hud-border transition-all duration-75 active:scale-95 shadow-lg",
                    active.horn
                      ? "border-primary bg-primary text-black font-bold scale-95 shadow-glow"
                      : "bg-hud/90 text-foreground/90 hover:bg-secondary",
                  )}
                >
                  <Volume1 className="size-4 text-primary" />
                  <span className="font-display text-sm tracking-widest">{t.horn}</span>
                </button>

                <button
                  type="button"
                  onClick={cycleCamera}
                  aria-label={t.camera}
                  className="corner-cut flex items-center justify-center gap-2 px-4 py-2 border border-hud-border bg-hud/90 text-foreground/90 hover:bg-secondary transition-all duration-75 active:scale-95 shadow-lg"
                >
                  <Camera className="size-4 text-primary" />
                  <span className="font-display text-sm tracking-widest">
                    {camLabels[camView]}
                  </span>
                </button>
              </div>

              {isPc && (
                <p className="rounded bg-hud/80 px-3 py-1 font-display text-xs tracking-widest text-foreground/80">
                  W / ↑ · S / ↓ / ESPAÇO · A D / ← → · H · C · ESC
                </p>
              )}
              {/* Brake & Gas Pedals */}
              <div className={cn("flex w-full items-end justify-center gap-4", isPc && "hidden")}>
                {/* Brake Pedal */}
                <button
                  type="button"
                  {...press("brake")}
                  aria-label={t.brake}
                  className={cn(
                    "corner-cut flex h-[98px] w-[42%] max-w-[110px] flex-col items-center justify-end border-2 pb-2 transition-transform duration-75 select-none",
                    active.brake
                      ? "translate-y-1 scale-95 border-brake bg-brake/30"
                      : "border-pedal-ridge bg-pedal hover:brightness-110",
                  )}
                >
                  <div className="pedal-ridges mb-1.5 h-11 w-[78%]" />
                  <span
                    className={cn(
                      "font-display text-base tracking-widest",
                      active.brake ? "text-brake" : "text-foreground",
                    )}
                  >
                    {t.brake}
                  </span>
                </button>

                {/* Gas Pedal */}
                <button
                  type="button"
                  {...press("gas")}
                  aria-label={t.gas}
                  className={cn(
                    "corner-cut flex h-[126px] w-[42%] max-w-[100px] flex-col items-center justify-end border-2 pb-2 transition-transform duration-75 select-none",
                    active.gas
                      ? "translate-y-1 scale-95 border-pedal-active bg-primary/25"
                      : "border-pedal-ridge bg-pedal hover:brightness-110",
                  )}
                >
                  <div className="pedal-ridges mb-1.5 h-16 w-[72%]" />
                  <span
                    className={cn(
                      "font-display text-base tracking-wider",
                      active.gas ? "text-primary" : "text-foreground",
                    )}
                  >
                    {t.gas}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Menu Screen (Requirements 6, 7, 10, 11) */}
        {phase === "menu" && (
          <div
            className={cn(
              "absolute inset-0 z-30 flex flex-col overflow-y-auto",
              // PC: the wide, bright road shows through the middle of the screen,
              // so dim the whole view and gather the menu into one solid panel.
              isPc ? "bg-scrim backdrop-blur-[3px]" : "justify-between",
            )}
          >
            <div
              className={cn(
                isPc ? "m-auto flex w-full max-w-md flex-col gap-3 px-4 py-6" : "contents",
              )}
            >
            {/* Header / Brand */}
            <div
              className={cn(
                "animate-rise-in px-6 text-center",
                isPc
                  ? "pb-2 pt-2 drop-shadow-[0_2px_8px_var(--color-background)]"
                  : "bg-scrim-top pb-6 pt-[max(env(safe-area-inset-top),24px)]",
              )}
            >
              <div className="mx-auto mb-2 flex items-center justify-center gap-2">
                <span className="rounded bg-primary/20 px-2 py-0.5 text-[11px] font-bold tracking-widest text-primary border border-primary/30">
                  {t.demoBadge}
                </span>
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="flex items-center gap-1 rounded bg-secondary/80 px-2 py-0.5 text-xs text-foreground/80 hover:bg-secondary border border-hud-border transition-colors"
                >
                  <Globe className="size-3 text-primary" />
                  <span>{LANGUAGES.find((l) => l.id === lang)?.flag}</span>
                </button>
              </div>

              <img
                src={bullEmblem}
                alt="Emblem"
                width={200}
                height={228}
                className="mx-auto mb-2 h-20 w-auto drop-shadow-[0_4px_16px_var(--color-primary)]"
              />
              <p className="font-display text-lg tracking-[0.4em] text-primary">{t.brand}</p>
              <h1 className="font-display text-6xl leading-[0.88] text-foreground">{t.model}</h1>
              <p className="mt-1 font-display text-xl tracking-[0.3em] text-muted-foreground">
                {t.subtitle}
              </p>
            </div>

            {/* Menu Options & Mode Selector */}
            <div
              className={cn(
                "animate-rise-in flex flex-col items-center gap-4 px-6 text-center",
                isPc
                  ? "corner-cut border border-hud-border bg-hud py-6 shadow-lg backdrop-blur-md"
                  : "bg-scrim-bottom pb-[max(env(safe-area-inset-bottom),24px)] pt-6",
              )}
            >
              {/* Game Mode Selector (Requirement 6: Police Escape mode) */}
              <div className="w-full max-w-xs space-y-1.5">
                <p className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                  {t.modeSelect}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("free")}
                    className={cn(
                      "corner-cut flex flex-col items-center justify-center py-2 px-2 border transition-all text-xs font-bold",
                      mode === "free"
                        ? "border-primary bg-primary/20 text-primary shadow-glow"
                        : "border-hud-border bg-hud text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    <Zap className="size-4 mb-1" />
                    <span>{t.modeFree}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode("police")}
                    className={cn(
                      "corner-cut flex flex-col items-center justify-center py-2 px-2 border transition-all text-xs font-bold",
                      mode === "police"
                        ? "border-rose-500 bg-rose-500/25 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.4)]"
                        : "border-hud-border bg-hud text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    <ShieldAlert className="size-4 mb-1 text-rose-500" />
                    <span>{t.modePolice}</span>
                  </button>
                </div>
              </div>

              {/* Controls guide */}
              <ul className="space-y-1 text-xs font-medium text-foreground/80 max-w-xs">
                {t.instructions.map((ins, idx) => (
                  <li key={idx} className="flex items-center justify-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-primary" />
                    <span>{ins.text}</span>
                  </li>
                ))}
              </ul>

              {/* Start Button */}
              <Button
                variant="race"
                size="xl"
                className="w-full max-w-xs text-xl py-6 font-display tracking-widest shadow-glow"
                onClick={() => startGame()}
              >
                {t.play}
              </Button>

              {/* Secondary Buttons: Paint / Change Car (Requirement 7) & Settings (Requirement 10) */}
              <div className="flex w-full max-w-xs flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-primary/40 bg-hud/80 text-foreground hover:bg-secondary text-xs"
                  onClick={() => setShowGp(true)}
                >
                  <Car className="size-3.5 mr-1.5 text-primary" />
                  {gpText(lang).menuButton}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-primary/40 bg-hud/80 text-foreground hover:bg-secondary text-xs"
                  onClick={() => setShowPoliceOff(true)}
                >
                  <ShoppingBag className="size-3.5 mr-1.5 text-primary" />
                  Loja
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-hud-border bg-hud/80 text-foreground hover:bg-secondary text-xs"
                  onClick={() => setShowDemoModal(true)}
                >
                  <Palette className="size-3.5 mr-1.5 text-primary" />
                  {t.paintCar}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowSettingsModal(true)}
                >
                  <Settings className="size-3.5 mr-1.5" />
                  {t.settings}
                </Button>
              </div>

              {bestScore > 0 && (
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t.record}: {formatKm(bestScore)} km
                </p>
              )}
            </div>
            </div>
          </div>
        )}

        {/* Game Over / Victory Screen */}
        {phase === "over" && result && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-scrim px-6">
            <div className="animate-rise-in w-full max-w-xs text-center">
              {/* Header based on outcome: crash vs busted vs escaped */}
              {result.outcome === "escaped" ? (
                <>
                  <Trophy className="mx-auto size-14 text-emerald-400 mb-2 animate-bounce" />
                  <h2 className="font-display text-5xl leading-none text-emerald-400">
                    {t.escapedTitle}
                  </h2>
                  <p className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-emerald-300">
                    {t.escapedDesc}
                  </p>
                </>
              ) : result.outcome === "busted" ? (
                <>
                  <ShieldAlert className="mx-auto size-14 text-rose-500 mb-2 animate-pulse" />
                  <h2 className="font-display text-6xl leading-none text-rose-500">
                    {t.bustedTitle}
                  </h2>
                  <p className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-rose-300">
                    {t.bustedDesc}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="font-display text-6xl leading-none text-brake">
                    {t.crashedTitle}
                  </h2>
                  <p className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    {t.crashedDesc}
                  </p>
                </>
              )}

              {result.record && (
                <p className="animate-pulse-soft mt-3 font-display text-xl tracking-widest text-primary">
                  {t.newRecord}
                </p>
              )}

              {/* Stats Grid */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="corner-cut border border-hud-border bg-hud px-3 py-2.5">
                  <div className="font-display text-3xl leading-none tabular-nums">
                    {formatKm(result.distance)}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.kmDriven}
                  </div>
                </div>
                <div className="corner-cut border border-hud-border bg-hud px-3 py-2.5">
                  <div className="font-display text-3xl leading-none tabular-nums">
                    {Math.round(result.topSpeed)}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.maxSpeed}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-5 space-y-2">
                <Button
                  variant="race"
                  size="xl"
                  className="w-full text-base font-display tracking-widest"
                  onClick={() => startGame()}
                >
                  <RotateCcw className="size-5 mr-1" /> {t.restart}
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  className="w-full border-hud-border bg-hud text-foreground hover:bg-secondary text-sm"
                  onClick={() => setPhase("menu")}
                >
                  {t.menu}
                </Button>
              </div>

              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t.record}: {formatKm(bestScore)} km
              </p>
            </div>
          </div>
        )}

        {/* Pause Modal */}
        {isPaused && phase === "playing" && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
            <div className="w-full max-w-sm corner-cut border-2 border-primary/60 bg-card p-6 shadow-2xl text-center animate-rise-in">
              <h2 className="font-display text-4xl text-primary tracking-wider mb-1">
                JOGO PAUSADO
              </h2>
              <p className="text-xs text-muted-foreground mb-6 uppercase tracking-widest font-semibold">
                Revuelto Highway Dash 3D
              </p>

              <div className="space-y-3">
                <Button
                  className="w-full py-6 text-lg font-display tracking-widest bg-primary text-black hover:bg-primary/90 corner-cut font-bold shadow-glow"
                  onClick={togglePause}
                >
                  <Play className="mr-2 size-5 fill-current" />
                  CONTINUAR
                </Button>

                <Button
                  variant="outline"
                  className="w-full py-5 font-display tracking-wider border-hud-border bg-hud text-foreground hover:bg-secondary corner-cut text-sm"
                  onClick={() => startGame(mode)}
                >
                  <RotateCcw className="mr-2 size-4" />
                  REINICIAR CORRIDA
                </Button>

                <Button
                  variant="outline"
                  className="w-full py-5 font-display tracking-wider border-hud-border bg-hud text-foreground hover:bg-secondary corner-cut text-sm"
                  onClick={toggleMute}
                >
                  {muted ? (
                    <VolumeX className="mr-2 size-4 text-brake" />
                  ) : (
                    <Volume2 className="mr-2 size-4 text-primary" />
                  )}
                  {muted ? "ATIVAR SOM" : "DESATIVAR SOM"}
                </Button>

                <Button
                  variant="ghost"
                  className="w-full py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setIsPaused(false);
                    if (engineRef.current) engineRef.current.paused = false;
                    setPhase("menu");
                  }}
                >
                  {t.menu}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Loading screen */}
        {phase === "loading" && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-background/95">
            <Flame className="size-12 text-primary animate-pulse mb-3" />
            <p className="animate-pulse-soft font-display text-2xl tracking-[0.3em] text-primary">
              CARREGANDO
            </p>
          </div>
        )}

        {showGp && <GpMode lang={lang} isPc={isPc} onClose={() => setShowGp(false)} />}

        {/* Requirement 7: Demo Alert Dialog ("Pintar carro, trocar de carro") */}
        {showDemoModal && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 px-4">
            <div className="corner-cut border border-primary/50 bg-card p-5 max-w-sm text-center shadow-2xl animate-rise-in">
              <Palette className="mx-auto size-10 text-primary mb-2" />
              <h3 className="font-display text-2xl tracking-wide text-foreground">
                {t.demoModalTitle}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t.demoModalMsg}</p>
              <div className="mt-5">
                <Button
                  variant="default"
                  className="w-full font-bold text-xs"
                  onClick={() => setShowDemoModal(false)}
                >
                  {t.close}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Requirement 10: Language Selection Dialog (First Visit or from Menu Settings) */}
        {(showFirstLangModal || showSettingsModal) && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 px-4">
            <div className="corner-cut border border-hud-border bg-card p-5 w-full max-w-sm shadow-2xl animate-rise-in">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Globe className="size-5 text-primary" />
                  <h3 className="font-display text-xl tracking-wider text-foreground">
                    {t.langModalTitle}
                  </h3>
                </div>
                {showSettingsModal && (
                  <button
                    onClick={() => setShowSettingsModal(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              <p className="mt-2 text-xs text-muted-foreground">{t.langModalSubtitle}</p>

              <div className="mt-4 grid grid-cols-1 gap-2">
                {LANGUAGES.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => selectLanguage(item.id)}
                    className={cn(
                      "flex items-center justify-between px-3.5 py-2.5 rounded border text-sm font-medium transition-all text-left",
                      lang === item.id
                        ? "border-primary bg-primary/20 text-primary font-bold shadow-sm"
                        : "border-hud-border bg-secondary/50 text-foreground/90 hover:bg-secondary",
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="text-xl">{item.flag}</span>
                      <span>{item.label}</span>
                    </span>
                    {lang === item.id && <span className="text-xs text-primary font-bold">✓</span>}
                  </button>
                ))}
              </div>

              {showSettingsModal && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Controles / Controls
                  </p>
                  <div className="mb-3 grid grid-cols-3 gap-2">
                    {(
                      [
                        ["auto", "Auto"],
                        ["pc", "PC"],
                        ["touch", "Celular"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => chooseUi(id)}
                        className={cn(
                          "rounded border px-2 py-2 text-xs font-bold",
                          uiPref === id
                            ? "border-primary bg-primary/20 text-primary"
                            : "border-hud-border bg-secondary/50 text-foreground/90",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    className="w-full text-xs"
                    onClick={() => setShowSettingsModal(false)}
                  >
                    {t.close}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
        {showPoliceOff && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-scrim px-6">
            <div className="corner-cut w-full max-w-xs border border-hud-border bg-card p-5 text-center">
              <ShoppingBag className="mx-auto mb-2 size-10 text-primary" />
              <h2 className="font-display text-3xl text-foreground">Loja</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                O jogo está na versão DEMO. A loja ainda vai ser implementada nas atualizações
                futuras.
              </p>
              <Button
                variant="race"
                className="mt-4 w-full font-display tracking-widest"
                onClick={() => setShowPoliceOff(false)}
              >
                VOLTAR
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
