export type SfxId = "move" | "hit" | "pickup" | "ui" | "explosion" | "win" | "lose";
const MUTE_KEY = "game.muted";

function readMuted(): boolean { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } }
function writeMuted(v: boolean): void { try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch { /* memory fallback */ } }

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicOsc: OscillatorNode | null = null;
  private musicLfo: OscillatorNode | null = null;
  private disposed = false;
  muted = false;
  private readonly unlock = () => { this.ensureCtx(); this.detachUnlock(); };

  constructor() {
    this.muted = readMuted();
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
  }
  private detachUnlock(): void {
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.detachUnlock(); this.stopMusic();
    this.master?.disconnect(); this.master = null;
    const ctx = this.ctx; this.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }
  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext(); this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.48; this.master.connect(this.ctx.destination);
      const length = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let seed = 19;
      for (let i = 0; i < length; i++) { seed = (seed * 16807) % 2147483647; data[i] = (seed / 2147483647) * 2 - 1; }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }
  toggleMute(): boolean {
    this.muted = !this.muted; writeMuted(this.muted);
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.48;
    return this.muted;
  }
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number): void {
    if (this.disposed || this.muted) return;
    const ctx = this.ensureCtx(); if (!this.master) return;
    const t = ctx.currentTime, osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    env.gain.setValueAtTime(gain, t); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(this.master); osc.start(t); osc.stop(t + dur);
  }
  private noise(dur: number, gain: number, frequency: number): void {
    if (this.disposed || this.muted) return;
    const ctx = this.ensureCtx(); if (!this.master || !this.noiseBuffer) return;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), env = ctx.createGain();
    src.buffer = this.noiseBuffer; filter.type = "lowpass"; filter.frequency.value = frequency;
    env.gain.setValueAtTime(gain, ctx.currentTime); env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter).connect(env).connect(this.master); src.start(); src.stop(ctx.currentTime + dur);
  }
  sfx(id: SfxId): void {
    const spec: Record<SfxId, [OscillatorType, number, number, number, number]> = {
      move: ["triangle", 150, 100, 0.055, 0.07], hit: ["square", 520, 220, 0.07, 0.15],
      pickup: ["sine", 660, 990, 0.12, 0.20], ui: ["sine", 440, 520, 0.05, 0.12],
      explosion: ["sawtooth", 120, 30, 0.4, 0.30], win: ["sine", 523, 1046, 0.5, 0.24],
      lose: ["sawtooth", 220, 55, 0.6, 0.22],
    };
    this.tone(...spec[id]);
  }
  shot(sniper = false): void { this.noise(sniper ? 0.34 : 0.13, sniper ? 0.55 : 0.32, sniper ? 1500 : 2200); this.tone("square", sniper ? 105 : 145, 45, sniper ? 0.24 : 0.09, 0.22); }
  enemyShot(): void { this.noise(0.08, 0.10, 1200); }
  dry(): void { this.tone("square", 170, 120, 0.035, 0.10); }
  reload(): void { this.noise(0.045, 0.09, 3500); setTimeout(() => this.tone("triangle", 250, 180, 0.06, 0.08), 180); }
  hurt(): void { this.noise(0.12, 0.16, 500); }
  step(): void { this.noise(0.045, 0.045, 380); }
  startMusic(): void {
    if (this.disposed) return; const ctx = this.ensureCtx(); if (this.musicOsc) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 55; gain.gain.value = 0.035;
    lfo.frequency.value = 1.6; lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain).connect(gain.gain); osc.connect(gain).connect(this.master!);
    osc.start(); lfo.start(); this.musicOsc = osc; this.musicLfo = lfo;
  }
  stopMusic(): void { this.musicOsc?.stop(); this.musicLfo?.stop(); this.musicOsc = null; this.musicLfo = null; }
}
