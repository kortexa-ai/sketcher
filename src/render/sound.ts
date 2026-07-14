/**
 * Procedural pencil-scratch audio: a looped noise buffer through a bandpass
 * filter, with loudness and brightness following how fast the pencil moves.
 * No audio assets; degrades to silence where WebAudio is unavailable or the
 * page hasn't had a user gesture yet.
 */
export class PencilScratch {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private started = false;
  enabled = true;

  /** Call every frame with normalized tip speed (0 = still, 1 = flat out). */
  update(speed: number): void {
    if (!this.enabled || speed <= 0) {
      this.duck();
      return;
    }
    // Lazy start: by the time drawing begins the page has had a click,
    // so the AudioContext is allowed to run.
    if (!this.started) this.start();
    if (!this.ctx || !this.gain || !this.filter) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const t = this.ctx.currentTime;
    const s = Math.min(1, Math.max(0, speed));
    this.gain.gain.setTargetAtTime(scratchGain(s), t, 0.06);
    this.filter.frequency.setTargetAtTime(900 + 2600 * s, t, 0.08);
  }

  private duck(): void {
    if (this.ctx && this.gain) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  private start(): void {
    this.started = true;
    if (typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); // 1 s loop
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    this.ctx = ctx;
    this.gain = gain;
    this.filter = filter;
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.gain = null;
    this.filter = null;
  }
}

/** Speed → loudness. Subtle: pencil scratch is a texture, not a soundtrack. */
export function scratchGain(speed: number): number {
  const s = Math.min(1, Math.max(0, speed));
  return s <= 0.02 ? 0 : 0.03 + 0.09 * s;
}
