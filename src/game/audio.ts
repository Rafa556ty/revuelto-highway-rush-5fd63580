// Authentic Lamborghini Revuelto V12 Engine Sound Engine
// Realistic 6.5L Naturally Aspirated V12 (L545) with 9,500 RPM redline:
//  - Deep, rhythmic 1,000 RPM idle thrum with mechanical valvetrain character
//  - Screaming high-pitched V12 acceleration pulls from Forza Horizon 6 Revuelto recording
//  - Continuous scream in top gear ("sem mais marchas") without any gear shifts
//  - Crisp ignition-cut gearshifts with explosive exhaust pops and backfire flames
//  - Overrun crackles and burble on deceleration
//  - Enclosed resonant tunnel muffling
//  - Dual European acoustic horn and dynamic police siren
//  - High-precision metallic crash and tire screech
import { GEAR_TOP, GEARS, IDLE_RPM, REDLINE, pickGear } from "./gearbox";
import idleWav from "@/assets/sounds/revuelto-idle.wav.asset.json";
import revWav from "@/assets/sounds/revuelto-rev.wav.asset.json";

const MASTER = 0.82;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Map engine rpm to the fundamental acoustic pitch of the Lamborghini V12. */
export const rpmToHz = (rpm: number) => 80 + ((rpm - 1500) * 260) / 7000;

// Authentic Forza Horizon 6 gear pull slices from uploaded Revuelto quarter-mile audio
export const GEAR_OFFSETS: [number, number][] = [
  [0.05, 1.25], // Gear 1 (Launch & 1st pull)
  [1.25, 2.2], // Gear 2
  [2.2, 3.25], // Gear 3
  [3.25, 3.8], // Gear 4
  [3.8, 4.4], // Gear 5
  [4.4, 4.8], // Gear 6
  [4.8, 5.25], // Gear 7
  [5.25, 6.28], // Gear 8 / Top Gear (SEM MAIS MARCHAS - continuous scream loop)
];

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  // Authentic Forza Horizon 6 Revuelto engine playback nodes
  private forzaBuf: AudioBuffer | null = null;
  private topGearBuf: AudioBuffer | null = null;
  private forzaGain: GainNode | null = null;
  private topGearGain: GainNode | null = null;
  private forzaSrc: AudioBufferSourceNode | null = null;
  private topGearSrc: AudioBufferSourceNode | null = null;
  private currentPlayingGear = -1;
  private isTopGearActive = false;

  // Master engine bus & shaping filters
  private loadBus: GainNode | null = null;
  private loadFilter: BiquadFilterNode | null = null;
  private shiftGain: GainNode | null = null;
  private idleGain: GainNode | null = null;
  private idleSrc: AudioBufferSourceNode | null = null;
  private tunnelLP: BiquadFilterNode | null = null;
  private comp: DynamicsCompressorNode | null = null;

  // Wind and tyre noise
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private revBuf: AudioBuffer | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private muted = false;

  // Horn nodes
  private hornGain: GainNode | null = null;
  private hornOsc1: OscillatorNode | null = null;
  private hornOsc2: OscillatorNode | null = null;
  private hornFilter: BiquadFilterNode | null = null;

  // Police siren nodes
  private policeGain: GainNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenLfo: OscillatorNode | null = null;
  private sirenLfoGain: GainNode | null = null;
  private policeEngineGain: GainNode | null = null;
  private policeEngineOsc: OscillatorNode | null = null;

  // Boost (KERS electric motor) nodes
  private boostGain: GainNode | null = null;
  private boostOsc: OscillatorNode | null = null;

  // Tire screech nodes (pneu cantando)
  private skidBuf: AudioBuffer | null = null;
  private skidGain: GainNode | null = null;
  private skidSrc: AudioBufferSourceNode | null = null;
  private tireGain: GainNode | null = null;
  private tireOsc1: OscillatorNode | null = null;
  private tireOsc2: OscillatorNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;

  // Engine telemetry state
  private rpm = IDLE_RPM;
  private gear = 0;
  private hz = rpmToHz(IDLE_RPM);
  private throttle = false;
  private lastT = 0;
  private crackleUntil = 0;
  private inTunnel = false;
  private tunnelBoom: BiquadFilterNode | null = null;
  private tunnelSend: GainNode | null = null;
  private sirenDistLP: BiquadFilterNode | null = null;
  private lastGap = 999;

  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;

      // Dynamics compressor to give aggressive, punchy exhaust presence without clipping
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 8;
      comp.ratio.value = 4.5;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER;
      // Tunnel muffler: everything from the car passes here
      this.tunnelLP = ctx.createBiquadFilter();
      this.tunnelLP.type = "lowpass";
      this.tunnelLP.frequency.value = 18000;
      this.tunnelLP.Q.value = 0.9;
      // Tunnel body: low-mid boom + concrete echo send (off outside tunnels)
      this.tunnelBoom = ctx.createBiquadFilter();
      this.tunnelBoom.type = "lowshelf";
      this.tunnelBoom.frequency.value = 220;
      this.tunnelBoom.gain.value = 0;
      this.tunnelLP.connect(this.tunnelBoom);
      this.tunnelBoom.connect(comp);
      this.master.connect(this.tunnelLP);
      this.tunnelSend = ctx.createGain();
      this.tunnelSend.gain.value = 0;
      this.master.connect(this.tunnelSend);
      const echoTone = ctx.createBiquadFilter();
      echoTone.type = "lowpass";
      echoTone.frequency.value = 2200;
      this.tunnelSend.connect(echoTone);
      for (const [time, fb] of [
        [0.067, 0.42],
        [0.113, 0.36],
        [0.171, 0.3],
      ] as const) {
        const d = ctx.createDelay(0.5);
        d.delayTime.value = time;
        const f = ctx.createGain();
        f.gain.value = fb;
        echoTone.connect(d);
        d.connect(f);
        f.connect(d);
        const out = ctx.createGain();
        out.gain.value = 0.55;
        d.connect(out);
        out.connect(comp);
      }
      this.comp = comp;

      // Engine bus
      this.loadBus = ctx.createGain();
      this.loadBus.gain.value = 0;
      this.loadBus.connect(this.master);

      this.loadFilter = ctx.createBiquadFilter();
      this.loadFilter.type = "lowpass";
      this.loadFilter.frequency.value = 7500;
      this.loadFilter.Q.value = 0.7;
      this.loadFilter.connect(this.loadBus);

      // Deep V12 exhaust low-end boost (240 Hz low shelf)
      const body = ctx.createBiquadFilter();
      body.type = "lowshelf";
      body.frequency.value = 240;
      body.gain.value = 7;
      body.connect(this.loadFilter);

      this.shiftGain = ctx.createGain();
      this.shiftGain.connect(body);

      // Forza engine gain node
      this.forzaGain = ctx.createGain();
      this.forzaGain.gain.value = 0;
      this.forzaGain.connect(this.shiftGain);

      // Top gear continuous scream gain node
      this.topGearGain = ctx.createGain();
      this.topGearGain.gain.value = 0;
      this.topGearGain.connect(this.shiftGain);

      // Idle bus
      this.idleGain = ctx.createGain();
      this.idleGain.gain.value = 0;
      this.idleGain.connect(this.master);

      // Wind and road noise buffer
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const nd = this.noiseBuf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) {
        b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
        nd[i] = b * 6 + (Math.random() * 2 - 1) * 0.15;
      }

      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = "bandpass";
      this.windFilter.frequency.value = 500;
      this.windFilter.Q.value = 0.5;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.master);

      const wind = ctx.createBufferSource();
      wind.buffer = this.noiseBuf;
      wind.loop = true;
      wind.connect(this.windFilter);
      wind.start();
      this.windSrc = wind;

      // Police pursuit siren & engine setup
      this.setupPoliceAudio(ctx);

      // Boost KERS electric motor whine
      this.boostGain = ctx.createGain();
      this.boostGain.gain.value = 0;
      this.boostGain.connect(this.master);

      this.boostOsc = ctx.createOscillator();
      this.boostOsc.type = "sawtooth";
      this.boostOsc.frequency.value = 1400;

      const boostFilter = ctx.createBiquadFilter();
      boostFilter.type = "bandpass";
      boostFilter.frequency.value = 2200;
      boostFilter.Q.value = 3.0;

      this.boostOsc.connect(boostFilter);
      boostFilter.connect(this.boostGain);
      this.boostOsc.start();

      // Tire screech (pneu cantando) setup
      this.setupTireAudio(ctx);

      // Load authentic audio samples
      void this.loadSamples(ctx);

      // Lightweight overrun crackle scheduler (60ms interval, avoids GC pressure on mobile)
      this.timer = setInterval(() => this.tick(), 60);
    }
    void this.ctx.resume();
  }

  // ---------- Authentic V12 samples loading ----------
  private async loadSamples(ctx: AudioContext) {
    const get = async (urls: string[]) => {
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const arr = await res.arrayBuffer();
            return await ctx.decodeAudioData(arr);
          }
        } catch {
          // try next url fallback
        }
      }
      throw new Error(`Failed to load audio from: ${urls.join(", ")}`);
    };

    try {
      const [idle, rev, forza, topGear, skid] = await Promise.all([
        get([idleWav.url, "/game-assets/revuelto-idle.wav"]),
        get([revWav.url, "/game-assets/revuelto-rev.wav"]),
        get([
          "/game-assets/revuelto-forza.mp3",
          "/assets/aistudio/Forza_Horizon_6_Lamborghini_Revuelto_Fully_Built_Orginal_Motor_Quarter_Mile_7.9__cut_6sec__070ae31a.mp3",
        ]),
        get(["/game-assets/revuelto-top-gear.wav"]),
        get([
          "/game-assets/tire-screech.mp3",
          "/assets/aistudio/carro-cantando-pneu__cut_4sec__83efc857.mp3",
        ]),
      ]);

      if (this.ctx !== ctx || !this.idleGain || !this.topGearGain) return;
      this.revBuf = rev;
      this.forzaBuf = forza;
      this.topGearBuf = topGear;
      this.skidBuf = skid;

      // Idle loop
      this.idleSrc = ctx.createBufferSource();
      this.idleSrc.buffer = idle;
      this.idleSrc.loop = true;
      this.idleSrc.connect(this.idleGain);
      this.idleSrc.start();

      // Continuous screaming top gear loop ("sem mais marchas")
      this.topGearSrc = ctx.createBufferSource();
      this.topGearSrc.buffer = topGear;
      this.topGearSrc.loop = true;
      this.topGearSrc.connect(this.topGearGain);
      this.topGearSrc.start();
    } catch (err) {
      console.warn("Engine audio samples load notice:", err);
    }
  }

  private setupPoliceAudio(ctx: AudioContext) {
    if (!this.master) return;
    this.policeGain = ctx.createGain();
    this.policeGain.gain.value = 0;
    // Distance muffling: far sirens lose their highs, like in real life
    this.sirenDistLP = ctx.createBiquadFilter();
    this.sirenDistLP.type = "lowpass";
    this.sirenDistLP.frequency.value = 900;
    this.policeGain.connect(this.sirenDistLP);
    this.sirenDistLP.connect(this.master);

    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = "lowpass";
    sirenFilter.frequency.value = 2600;
    sirenFilter.Q.value = 0.5;

    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = "triangle";
    this.sirenOsc.frequency.value = 1000;

    this.sirenLfo = ctx.createOscillator();
    this.sirenLfo.type = "sine";
    this.sirenLfo.frequency.value = 0.3;

    this.sirenLfoGain = ctx.createGain();
    this.sirenLfoGain.gain.value = 380;

    this.sirenLfo.connect(this.sirenLfoGain);
    this.sirenLfoGain.connect(this.sirenOsc.frequency);

    const sirenToneGain = ctx.createGain();
    sirenToneGain.gain.value = 0.5;
    this.sirenOsc.connect(sirenFilter);
    sirenFilter.connect(sirenToneGain);
    sirenToneGain.connect(this.policeGain);

    this.sirenOsc.start();
    this.sirenLfo.start();

    this.policeEngineOsc = ctx.createOscillator();
    this.policeEngineOsc.type = "triangle";
    this.policeEngineOsc.frequency.value = 135;

    const peFilter = ctx.createBiquadFilter();
    peFilter.type = "lowpass";
    peFilter.frequency.value = 900;

    this.policeEngineGain = ctx.createGain();
    this.policeEngineGain.gain.value = 0;

    this.policeEngineOsc.connect(peFilter);
    peFilter.connect(this.policeEngineGain);
    this.policeEngineGain.connect(this.policeGain);
    this.policeEngineOsc.start();
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopHorn();
    this.stopForzaGear();
    try {
      this.topGearSrc?.stop();
      this.idleSrc?.stop();
      this.windSrc?.stop();
      this.skidSrc?.stop();
    } catch {
      // ignore
    }
    void this.ctx?.close();
    this.ctx = null;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.05);
  }

  /** One-shot real rev blip (played when the race starts). */
  rev() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (this.forzaBuf) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = this.forzaBuf;
        src.playbackRate.value = 1.05;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.9, t + 0.02);
        g.gain.setValueAtTime(0.9, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.15);
        src.connect(g);
        g.connect(this.master);
        src.start(t, 0.05, 1.15);
        return;
      } catch {
        // fallback
      }
    }
    if (this.revBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.revBuf;
      const g = ctx.createGain();
      g.gain.value = 0.85;
      src.connect(g);
      g.connect(this.master);
      src.start();
    }
  }

  // ---- Dual car horn (Buzina) ----
  startHorn(inTunnel = false) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (this.hornGain) return;

    const t = ctx.currentTime;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0, t);
    hg.gain.linearRampToValueAtTime(0.52, t + 0.03);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = inTunnel ? 720 : 1200;
    filter.Q.value = inTunnel ? 2.5 : 1.2;
    filter.connect(hg);
    hg.connect(this.master);

    const osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.value = 415;

    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.value = 520;

    osc1.connect(filter);
    osc2.connect(filter);

    osc1.start(t);
    osc2.start(t);

    this.hornGain = hg;
    this.hornOsc1 = osc1;
    this.hornOsc2 = osc2;
    this.hornFilter = filter;
  }

  stopHorn() {
    const ctx = this.ctx;
    if (!ctx || !this.hornGain) return;
    const t = ctx.currentTime;
    this.hornGain.gain.cancelScheduledValues(t);
    this.hornGain.gain.setValueAtTime(this.hornGain.gain.value, t);
    this.hornGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

    const o1 = this.hornOsc1;
    const o2 = this.hornOsc2;
    const hg = this.hornGain;
    setTimeout(() => {
      try {
        o1?.stop();
        o2?.stop();
        o1?.disconnect();
        o2?.disconnect();
        hg.disconnect();
      } catch {
        // cleanup ignore
      }
    }, 100);

    this.hornGain = null;
    this.hornOsc1 = null;
    this.hornOsc2 = null;
    this.hornFilter = null;
  }

  setPolice(gap: number, active: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.policeGain || !this.sirenLfo || !this.policeEngineGain) return;
    const t = ctx.currentTime;

    if (!active) {
      this.policeGain.gain.setTargetAtTime(0, t, 0.2);
      this.policeEngineGain.gain.setTargetAtTime(0, t, 0.2);
      return;
    }

    // Inverse-distance loudness: barely audible far away, loud when close
    const near = clamp(1 - gap / 600, 0, 1);
    const vol = clamp(0.012 + 0.44 * (18 / (18 + gap)) ** 0.9 * (0.35 + 0.65 * near), 0, 0.45);
    if (this.sirenDistLP) this.sirenDistLP.frequency.setTargetAtTime(700 + 7000 * near ** 1.5, t, 0.3);
    // Doppler: closing in raises the pitch slightly, falling back lowers it
    const closing = clamp((this.lastGap - gap) * 3, -40, 40);
    this.lastGap = gap;
    if (this.sirenOsc) this.sirenOsc.detune.setTargetAtTime(closing * 1.5, t, 0.25);
    const lfoRate = gap < 90 ? 2.8 : 0.3 + near * 0.25;
    this.policeGain.gain.setTargetAtTime(clamp(vol, 0, 0.45), t, 0.3);
    this.sirenLfo.frequency.setTargetAtTime(lfoRate, t, 0.2);

    const engVol = gap < 120 ? clamp((1 - gap / 120) * 0.1, 0, 0.1) : 0;
    this.policeEngineGain.gain.setTargetAtTime(engVol, t, 0.15);
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now < this.crackleUntil && Math.random() < 0.34) {
      this.pop(now + rnd(0.01, 0.04), rnd(0.25, 0.5));
    }
  }

  /** Short exhaust "pop" (overrun crackle / gear change). */
  pop(at: number, level: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = this.inTunnel ? rnd(350, 950) : rnd(550, 1700);
    bp.Q.value = this.inTunnel ? 2.2 : 1.2;
    const g = ctx.createGain();
    const d = rnd(0.025, 0.07);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, at + d);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(at, rnd(0, 1.5), d + 0.02);
  }

  fireExhaustBackfire() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.pop(t + 0.01, 0.85);
    this.pop(t + 0.05, 0.72);
    this.pop(t + 0.09, 0.55);
  }

  /** Ignition-cut gear shift dip and exhaust pop */
  private shift(t: number) {
    const s = this.shiftGain;
    if (!s) return;
    s.gain.cancelScheduledValues(t);
    s.gain.setValueAtTime(1, t);
    // Ignition cut dip on shift
    s.gain.linearRampToValueAtTime(0.18, t + 0.04);
    s.gain.linearRampToValueAtTime(1, t + 0.16);
    this.pop(t + 0.02, 0.65);
    this.pop(t + 0.06, 0.45);

    // Mechanical bang
    const ctx = this.ctx;
    if (ctx && this.revBuf && this.master) {
      const src = ctx.createBufferSource();
      src.buffer = this.revBuf;
      src.playbackRate.value = 1.15;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.55, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      src.connect(g);
      g.connect(this.master);
      src.start(t, 0.3, 0.16);
    }
  }

  private startForzaGear(g: number, speed: number) {
    const ctx = this.ctx;
    if (!ctx || !this.forzaBuf || !this.forzaGain) return;
    const offsets = GEAR_OFFSETS[g];
    if (!offsets) return;
    const [start, end] = offsets;

    this.stopForzaGear();

    try {
      const src = ctx.createBufferSource();
      src.buffer = this.forzaBuf;
      const topOfGear = GEAR_TOP[g] ?? 200;
      const rate = clamp(0.92 + (speed / topOfGear) * 0.22, 0.88, 1.28);
      src.playbackRate.value = rate;

      const dur = end - start;
      if (dur > 0.3) {
        src.loop = true;
        src.loopStart = start + dur * 0.4;
        src.loopEnd = Math.min(start + dur * 0.98, this.forzaBuf.duration - 0.05);
      }

      src.connect(this.forzaGain);
      src.start(ctx.currentTime, start);
      this.forzaSrc = src;
      this.currentPlayingGear = g;
    } catch (err) {
      console.warn("startForzaGear notice:", err);
    }
  }

  private stopForzaGear() {
    if (this.forzaSrc) {
      try {
        this.forzaSrc.stop();
        this.forzaSrc.disconnect();
      } catch {
        // ignore
      }
      this.forzaSrc = null;
    }
  }

  setEngine(
    speed: number,
    throttle: boolean,
    running: boolean,
    inTunnel = false,
    rain = 0,
    gear?: number,
  ) {
    const ctx = this.ctx;
    if (
      !ctx ||
      !this.idleGain ||
      !this.forzaGain ||
      !this.topGearGain ||
      !this.loadBus ||
      !this.loadFilter ||
      !this.windGain ||
      !this.windFilter
    )
      return;
    const t = ctx.currentTime;
    this.lastT = t;
    this.inTunnel = inTunnel;

    const rainHiss = rain > 0 ? rain * 0.22 : 0;
    const windTarget = running ? (inTunnel ? 0.12 : 0.22 + rainHiss) * (speed / 340) ** 2 : 0;
    this.windGain.gain.setTargetAtTime(windTarget, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(
      inTunnel ? 320 + speed * 2 : rain > 0.3 ? 750 + speed * 3.5 : 350 + speed * 4,
      t,
      0.2,
    );

    if (!running) {
      this.idleGain.gain.setTargetAtTime(0, t, 0.15);
      this.forzaGain.gain.setTargetAtTime(0, t, 0.15);
      this.topGearGain.gain.setTargetAtTime(0, t, 0.15);
      this.loadBus.gain.setTargetAtTime(0, t, 0.15);
      this.stopForzaGear();
      this.currentPlayingGear = -1;
      this.isTopGearActive = false;
      this.rpm = IDLE_RPM;
      this.gear = 0;
      this.crackleUntil = 0;
      this.throttle = false;
      return;
    }

    // 8-speed gearbox logic
    const g = gear !== undefined ? clamp(gear, 0, GEARS - 1) : pickGear(this.gear, speed, throttle);
    this.gear = g;

    // Top gear condition: 8th gear (g === 7) or speed >= 305 km/h ("sem mais marchas")
    const isTopGear = g >= GEARS - 1 || speed >= 305;

    if (isTopGear) {
      // SEM MAIS MARCHAS:
      // Continuous screaming V12 sound WITHOUT ANY GEAR SHIFTS ("sem troca de marchas")
      if (!this.isTopGearActive) {
        this.isTopGearActive = true;
        this.stopForzaGear();
        this.currentPlayingGear = -1;
      }

      const topVol = throttle ? 1.0 : 0.35;
      this.topGearGain.gain.setTargetAtTime(topVol, t, 0.08);
      this.forzaGain.gain.setTargetAtTime(0, t, 0.06);
      this.idleGain.gain.setTargetAtTime(0, t, 0.1);
      this.loadBus.gain.setTargetAtTime(1.0, t, 0.05);

      // Modulate continuous screaming pitch naturally with speed / throttle
      if (this.topGearSrc) {
        const topPitch = throttle ? clamp(0.96 + ((speed - 305) / 55) * 0.14, 0.94, 1.15) : 0.92;
        this.topGearSrc.playbackRate.setTargetAtTime(topPitch, t, 0.06);
      }

      this.rpm = clamp(8800 + ((speed - 305) / 50) * 700, 8500, REDLINE);
      this.hz = rpmToHz(this.rpm);
    } else {
      // Lower gears (1 to 7)
      if (this.isTopGearActive) {
        this.isTopGearActive = false;
        this.topGearGain.gain.setTargetAtTime(0, t, 0.08);
      }

      if (speed < 6) {
        // Idling at standstill
        this.idleGain.gain.setTargetAtTime(0.85, t, 0.1);
        this.forzaGain.gain.setTargetAtTime(0, t, 0.1);
        this.loadBus.gain.setTargetAtTime(0.2, t, 0.1);
        this.stopForzaGear();
        this.currentPlayingGear = -1;
        this.rpm = IDLE_RPM;
        this.hz = rpmToHz(IDLE_RPM);
      } else {
        // Accelerating through gears 1-7
        const targetRpm = clamp((REDLINE * speed) / (GEAR_TOP[g] ?? 300), 2500, REDLINE);
        this.rpm = targetRpm;
        this.hz = rpmToHz(this.rpm);

        // Upshift effect ONLY when shifting up between gears 1..7 (never in top gear)
        if (this.currentPlayingGear !== -1 && g > this.currentPlayingGear && throttle) {
          this.shift(t);
        }

        if (this.currentPlayingGear !== g) {
          this.startForzaGear(g, speed);
        } else if (this.forzaSrc) {
          const topOfGear = GEAR_TOP[g] ?? 200;
          const rate = clamp(0.92 + (speed / topOfGear) * 0.22, 0.88, 1.28);
          this.forzaSrc.playbackRate.setTargetAtTime(rate, t, 0.08);
        }

        const forzaVol = throttle ? 1.0 : 0.28;
        this.forzaGain.gain.setTargetAtTime(forzaVol, t, throttle ? 0.04 : 0.12);
        this.idleGain.gain.setTargetAtTime(throttle ? 0 : 0.25, t, 0.15);
        this.loadBus.gain.setTargetAtTime(throttle ? 1.0 : 0.35, t, 0.08);
      }
    }

    // Overrun crackles when lifting throttle at speed
    if (this.throttle && !throttle && speed > 60) {
      this.crackleUntil = t + 1.1;
    }
    if (throttle) {
      this.crackleUntil = 0;
    }
    this.throttle = throttle;

    this.loadFilter.frequency.setTargetAtTime(throttle ? 8000 : 2600, t, 0.08);

    if (this.tunnelLP) {
      this.tunnelLP.frequency.setTargetAtTime(inTunnel ? 3200 : 18000, t, inTunnel ? 0.2 : 0.35);
      this.tunnelLP.Q.setTargetAtTime(inTunnel ? 1.4 : 0.7, t, 0.2);
    }
    if (this.tunnelBoom) this.tunnelBoom.gain.setTargetAtTime(inTunnel ? 6 : 0, t, 0.25);
    if (this.tunnelSend) {
      this.tunnelSend.gain.setTargetAtTime(inTunnel ? 0.5 : 0, t, inTunnel ? 0.25 : 0.4);
    }
  }

  setBoost(active: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.boostGain || !this.boostOsc) return;
    const t = ctx.currentTime;
    if (active) {
      this.boostGain.gain.setTargetAtTime(0.32, t, 0.04);
      this.boostOsc.frequency.setTargetAtTime(2900, t, 0.12);
    } else {
      this.boostGain.gain.setTargetAtTime(0, t, 0.12);
      this.boostOsc.frequency.setTargetAtTime(1400, t, 0.2);
    }
  }

  playNearMissWhoosh() {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || !this.master) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.exponentialRampToValueAtTime(1700, t + 0.09);
    bp.frequency.exponentialRampToValueAtTime(320, t + 0.26);
    bp.Q.value = 2.2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.48, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.29);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t, rnd(0, 1.5), 0.3);
  }

  playCameraShutter() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(3200, t);
    osc.frequency.exponentialRampToValueAtTime(750, t + 0.08);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  private setupTireAudio(ctx: AudioContext) {
    if (!this.master) return;
    // Authentic recorded skid audio gain bus
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidGain.connect(this.master);

    // Friction overlay bus
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    this.tireGain.connect(this.master);

    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = "bandpass";
    this.tireFilter.frequency.value = 980;
    this.tireFilter.Q.value = 2.4;
    this.tireFilter.connect(this.tireGain);

    this.tireOsc1 = ctx.createOscillator();
    this.tireOsc1.type = "sawtooth";
    this.tireOsc1.frequency.value = 830;

    this.tireOsc2 = ctx.createOscillator();
    this.tireOsc2.type = "triangle";
    this.tireOsc2.frequency.value = 1180;

    this.tireOsc1.connect(this.tireFilter);
    this.tireOsc2.connect(this.tireFilter);
    // Oscillators intentionally not started (removed brake "beep").
  }

  setTireScreech(intensity: number) {
    const ctx = this.ctx;
    if (!ctx || !this.tireGain || !this.tireFilter) return;
    const t = ctx.currentTime;
    const clamped = clamp(intensity, 0, 1);
    if (clamped > 0.05) {
      // 1. Play real uploaded tire screech audio loop ("carro cantando pneu")
      if (this.skidBuf && this.skidGain) {
        if (!this.skidSrc) {
          try {
            const src = ctx.createBufferSource();
            src.buffer = this.skidBuf;
            src.loop = true;
            src.connect(this.skidGain);
            src.start(t);
            this.skidSrc = src;
          } catch {
            // fallback
          }
        }
        if (this.skidSrc) {
          this.skidSrc.playbackRate.setTargetAtTime(clamp(0.95 + clamped * 0.18, 0.92, 1.25), t, 0.04);
        }
        this.skidGain.gain.setTargetAtTime(clamp(0.15 + clamped * 0.8, 0, 0.95), t, 0.04);
      }

      // 2. High-frequency asphalt scrub overlay
      // Synth overlay muted: it sounded like a "beep"; only the real skid plays.
      this.tireGain.gain.setTargetAtTime(0, t, 0.04);
      this.tireFilter.frequency.setTargetAtTime(820 + clamped * 350, t, 0.05);
    } else {
      if (this.skidGain) this.skidGain.gain.setTargetAtTime(0, t, 0.06);
      this.tireGain.gain.setTargetAtTime(0, t, 0.07);
    }
  }

  /** Quick surprised horn beep from traffic car overtaken in a near miss */
  /** Near miss: the startled driver leans on the horn (one long or two short honks), falling behind. */
  playTrafficHorn() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.05;
    const base = rnd(330, 420); // car horns: two detuned tones about a major third apart
    const honks: [number, number][] =
      Math.random() < 0.5 ? [[0, rnd(0.45, 0.7)]] : [[0, 0.16], [0.24, rnd(0.35, 0.5)]];
    const pan = ctx.createStereoPanner();
    pan.pan.value = rnd(-0.6, 0.6);
    const body = ctx.createBiquadFilter();
    body.type = "bandpass";
    body.frequency.value = base * 2.2;
    body.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = 0;
    body.connect(g);
    g.connect(pan);
    pan.connect(this.master);
    const end = honks[honks.length - 1]!;
    const stopAt = t + end[0] + end[1] + 0.1;
    for (const f of [base, base * 1.26]) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(f, t);
      // the car drops behind fast: pitch sags slightly (doppler)
      o.frequency.linearRampToValueAtTime(f * 0.94, stopAt);
      o.connect(body);
      o.start(t);
      o.stop(stopAt);
    }
    for (const [at, len] of honks) {
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.16, t + at + 0.015);
      g.gain.setValueAtTime(0.16 * 0.7, t + at + len);
      g.gain.linearRampToValueAtTime(0, t + at + len + 0.04);
    }
  }

  crash() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // 1. Heavy low-frequency chassis frame impact thud
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(95, t);
    thump.frequency.exponentialRampToValueAtTime(28, t + 0.42);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(1.0, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    thump.connect(tg);
    tg.connect(this.master);
    thump.start(t);
    thump.stop(t + 0.6);

    // 2. Realistic metallic sheet crumple & structural crush (high-Q metallic ring)
    const len = Math.floor(ctx.sampleRate * 1.5);
    const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const decay = Math.pow(1 - i / len, 1.8);
      data[i] = (Math.random() * 2 - 1) * decay;
    }

    const metalPitches = [920, 1640, 2850];
    for (const freq of metalPitches) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(freq, t);
      bp.frequency.exponentialRampToValueAtTime(freq * 0.72, t + 0.8);
      bp.Q.value = 5.2; // Strong metallic clang resonance

      const mg = ctx.createGain();
      mg.gain.setValueAtTime(0.85, t);
      mg.gain.exponentialRampToValueAtTime(0.001, t + 0.95);

      src.connect(bp);
      bp.connect(mg);
      mg.connect(this.master);
      src.start(t);
    }

    // 3. High-frequency shattered glass & carbon fiber crunch
    const glassSrc = ctx.createBufferSource();
    glassSrc.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(3200, t);
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0.65, t);
    gg.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    glassSrc.connect(hp);
    hp.connect(gg);
    gg.connect(this.master);
    glassSrc.start(t);

    // 4. Skidding tire squeak on asphalt during collision
    this.setTireScreech(1.0);
    setTimeout(() => {
      this.setTireScreech(0);
    }, 600);
  }
}
