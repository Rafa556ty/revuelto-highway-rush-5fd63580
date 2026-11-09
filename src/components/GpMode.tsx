import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Flag, Flame, Globe, Lock, Timer, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GP_CARS, canSelectGpCar, getGpCar, type GpCarId } from "@/game/gp-cars";
import { gpText } from "@/lib/gp-i18n";
import type { Language } from "@/lib/i18n";

type Step = "hub" | "loading" | "cars" | "pit";

export function GpMode({ lang, isPc, onClose }: { lang: Language; isPc: boolean; onClose: () => void }) {
  const t = gpText(lang);
  const [step, setStep] = useState<Step>("hub");
  const [showDemo, setShowDemo] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [carId, setCarId] = useState<GpCarId>("bmw-m3-gtr");

  // Loading screen: download track + unlocked cars, then car select.
  useEffect(() => {
    if (step !== "loading") return;
    let alive = true;
    setProgress(0);
    setError("");
    import("@/game/gp-pit")
      .then((m) => m.preloadGp((r) => alive && setProgress(r)))
      .then(() => alive && setStep("cars"))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [step]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-background">
      {step === "hub" && (
        <div className="flex h-full flex-col overflow-y-auto bg-scrim">
          <Header title={t.hubTitle} sub={t.hubSub} onClose={onClose} closeLabel={t.exit} icon={<X className="size-5" />} />
          <div className={cn("m-auto grid w-full gap-4 px-5 py-6", isPc ? "max-w-3xl grid-cols-2" : "max-w-md")}>
            <button
              type="button"
              onClick={() => setStep("loading")}
              className="corner-cut animate-rise-in group flex flex-col gap-3 border border-primary bg-primary/15 p-5 text-left shadow-glow transition-transform hover:scale-[1.02]"
            >
              <div className="flex items-center justify-between">
                <Timer className="size-9 text-primary" />
                <span className="rounded border border-primary/50 bg-primary/20 px-2 py-0.5 text-[10px] font-bold tracking-widest text-primary">
                  {t.open}
                </span>
              </div>
              <h3 className="font-display text-3xl leading-none tracking-wide text-foreground">{t.practice}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{t.practiceDesc}</p>
            </button>

            <button
              type="button"
              onClick={() => setShowDemo(true)}
              className="corner-cut animate-rise-in relative flex flex-col gap-3 border border-hud-border bg-hud p-5 text-left opacity-80 transition-opacity hover:opacity-100"
            >
              <div className="flex items-center justify-between">
                <Globe className="size-9 text-muted-foreground" />
                <span className="flex items-center gap-1 rounded border border-hud-border bg-secondary px-2 py-0.5 text-[10px] font-bold tracking-widest text-muted-foreground">
                  <Lock className="size-3" /> {t.locked}
                </span>
              </div>
              <h3 className="font-display text-3xl leading-none tracking-wide text-foreground/70">{t.championship}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{t.championshipDesc}</p>
            </button>
          </div>
        </div>
      )}

      {step === "loading" && (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
          <Flag className="mb-1 size-12 animate-pulse text-primary" />
          <p className="font-display text-sm tracking-[0.3em] text-muted-foreground">{t.hubSub}</p>
          {error ? (
            <>
              <p className="font-display text-lg tracking-[0.2em] text-brake">{t.error}</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={() => setStep("hub")}>
                {t.back}
              </Button>
            </>
          ) : (
            <>
              <div className="h-1 w-48 overflow-hidden bg-secondary">
                <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="animate-pulse-soft font-display text-xl tracking-[0.3em] text-primary">
                {t.loading} {Math.round(progress * 100)}%
              </p>
            </>
          )}
        </div>
      )}

      {step === "cars" && (
        <div className="flex h-full flex-col overflow-y-auto bg-scrim">
          <Header
            title={t.selectTitle}
            sub={t.selectHint}
            onClose={() => setStep("hub")}
            closeLabel={t.back}
            icon={<ChevronLeft className="size-5" />}
          />
          <div className={cn("mx-auto grid w-full gap-3 px-5 py-5", isPc ? "max-w-4xl grid-cols-3" : "max-w-md grid-cols-2")}>
            {GP_CARS.map((car) => {
              const ok = canSelectGpCar(car.id);
              return (
                <button
                  key={car.id}
                  type="button"
                  disabled={!ok}
                  onClick={() => {
                    setCarId(car.id);
                    setStep("pit");
                  }}
                  className={cn(
                    "corner-cut animate-rise-in relative flex min-h-36 flex-col justify-between gap-2 border p-4 text-left transition-transform",
                    ok
                      ? "border-primary bg-primary/15 shadow-glow hover:scale-[1.03]"
                      : "cursor-not-allowed border-hud-border bg-hud",
                  )}
                >
                  <div className={cn(!ok && "opacity-40")}>
                    <p className="font-display text-xs tracking-[0.3em] text-primary">{car.brand}</p>
                    <p className="font-display text-2xl leading-none text-foreground">{car.name}</p>
                    <p className="mt-1 text-[10px] font-semibold tracking-wider text-muted-foreground">
                      {car.year} • {car.engine} • {car.power}
                    </p>
                  </div>
                  {ok ? (
                    <span className="self-start rounded bg-primary px-2 py-1 font-display text-sm tracking-widest text-primary-foreground">
                      {t.choose}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 self-start rounded border border-hud-border bg-secondary px-2 py-1 text-[10px] font-bold tracking-widest text-muted-foreground">
                      <Lock className="size-3" /> {t.unavailable}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === "pit" && (
        <PitView
          carId={carId}
          title={t.pitTitle}
          hint={t.pitHint}
          backLabel={t.back}
          exitLabel={t.exit}
          errorLabel={t.error}
          onBack={() => setStep("cars")}
          onExit={onClose}
        />
      )}

      {showDemo && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-scrim px-6">
          <div className="corner-cut w-full max-w-xs animate-rise-in border border-primary/50 bg-card p-5 text-center">
            <Trophy className="mx-auto mb-2 size-10 text-primary" />
            <h2 className="font-display text-3xl text-foreground">{t.demoTitle}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t.demoMsg}</p>
            <Button variant="race" className="mt-4 w-full font-display tracking-widest" onClick={() => setShowDemo(false)}>
              {t.ok}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({
  title,
  sub,
  onClose,
  closeLabel,
  icon,
}: {
  title: string;
  sub: string;
  onClose: () => void;
  closeLabel: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hud-border bg-scrim-top px-5 pb-3 pt-[max(env(safe-area-inset-top),18px)]">
      <div className="flex items-center gap-3">
        <Flame className="size-7 text-primary" />
        <div>
          <h2 className="font-display text-2xl leading-none tracking-[0.25em] text-primary">{title}</h2>
          <p className="mt-1 font-display text-[11px] tracking-[0.25em] text-muted-foreground">{sub}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="corner-cut border border-hud-border bg-hud p-2 text-foreground transition-colors hover:bg-secondary"
      >
        {icon}
      </button>
    </div>
  );
}

function PitView({
  carId,
  title,
  hint,
  backLabel,
  exitLabel,
  errorLabel,
  onBack,
  onExit,
}: {
  carId: GpCarId;
  title: string;
  hint: string;
  backLabel: string;
  exitLabel: string;
  errorLabel: string;
  onBack: () => void;
  onExit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const car = getGpCar(carId)!;

  useEffect(() => {
    const el = ref.current;
    if (!el || !car.model) return;
    let disposed = false;
    let handle: { dispose: () => void } | null = null;
    import("@/game/gp-pit")
      .then((m) => m.mountPit(el, car.model!))
      .then((h) => {
        if (disposed) h.dispose();
        else {
          handle = h;
          setReady(true);
        }
      })
      .catch((e: unknown) => !disposed && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      handle?.dispose();
    };
  }, [car]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="absolute inset-0 touch-none" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-scrim-top px-5 pb-8 pt-[max(env(safe-area-inset-top),16px)]">
        <div className="corner-cut border border-hud-border bg-hud px-4 py-2">
          <p className="font-display text-xs tracking-[0.3em] text-primary">{title}</p>
          <p className="font-display text-2xl leading-none text-foreground">
            {car.brand} {car.name}
          </p>
          <p className="text-[10px] font-semibold tracking-wider text-muted-foreground">
            {car.year} • {car.engine} • {car.power}
          </p>
        </div>
        <div className="pointer-events-auto flex gap-2">
          <Button variant="outline" size="sm" className="border-hud-border bg-hud text-xs" onClick={onBack}>
            <ChevronLeft className="mr-1 size-3.5" /> {backLabel}
          </Button>
          <Button variant="race" size="sm" className="font-display tracking-widest" onClick={onExit}>
            {exitLabel}
          </Button>
        </div>
      </div>
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90">
          <Flame className="size-10 animate-pulse text-primary" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/95 px-6 text-center">
          <p className="font-display text-lg tracking-[0.2em] text-brake">{errorLabel}</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      )}
      <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-scrim-bottom px-5 pb-[max(env(safe-area-inset-bottom),14px)] pt-6 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}
