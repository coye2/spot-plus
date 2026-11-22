// visualizer.js — Real Web Audio AnalyserNode music visualizers.
// Uses actual FFT frequency and time-domain audio data tapped from the master bus.
// Never simulates or fakes audio reactivity; gracefully explains if CORS blocks analysis.

export class MusicVisualizer {
  constructor({ canvas, glowTarget = null, ambientTarget = null, getAnalyser, isBlocked, isPlaying, getPalette } = {}) {
    this.canvas = canvas;
    this.ctx2d = canvas?.getContext?.('2d') || null;
    this.glowTarget = glowTarget;
    this.ambientTarget = ambientTarget;
    this.getAnalyser = getAnalyser || (() => null);
    this.isBlocked = isBlocked || (() => false);
    this.isPlaying = isPlaying || (() => false);
    this.getPalette = getPalette || (() => ({ color: '#1db954', surface: '#103829', deep: '#06150f' }));

    this.mode = 'off';
    this.active = false;
    this.raf = 0;
    this.lastDraw = 0;
    this.freqData = null;
    this.timeData = null;
    this.smoothBins = new Float32Array(48);
    this.energy = 0;
    this.bassEnergy = 0;
    this.onStatusChange = null;
    this.lastStatus = '';
  }

  setMode(mode) {
    this.mode = mode || 'off';
    if (this.mode === 'off') {
      this.stop();
      this.clear();
    } else if (this.active) {
      this.start();
    }
  }

  setActive(active) {
    this.active = !!active;
    if (this.active && this.mode !== 'off') this.start();
    else {
      this.stop();
      this.clear();
    }
  }

  isReducedMotion() {
    if (typeof document !== 'undefined' && (document.body?.dataset?.motion === 'reduced' || document.body?.dataset?.anim === 'reduced')) return true;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  reportStatus(status) {
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.onStatusChange?.(status);
    }
  }

  start() {
    if (this.raf || !this.active || this.mode === 'off') return;
    const loop = (now) => {
      this.raf = 0;
      if (!this.active || this.mode === 'off' || (typeof document !== 'undefined' && document.hidden)) {
        this.clear();
        return;
      }
      // Throttle to ~24fps on reduced-motion or low-core devices, ~60fps otherwise
      const lowPower = this.isReducedMotion() || (navigator?.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
      const minGap = lowPower ? 42 : 16;
      if (now - this.lastDraw >= minGap) {
        this.lastDraw = now;
        this.renderFrame();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  clear() {
    if (this.ctx2d && this.canvas) {
      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.glowTarget?.style?.removeProperty('--viz-bass');
    this.glowTarget?.style?.removeProperty('--viz-energy');
    this.ambientTarget?.style?.removeProperty('--viz-ambient');
    this.smoothBins.fill(0);
    this.energy = 0;
    this.bassEnergy = 0;
  }

  resizeIfNeeded() {
    if (!this.canvas) return false;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round((this.canvas.clientWidth || 320) * dpr));
    const h = Math.max(1, Math.round((this.canvas.clientHeight || 160) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return true;
  }

  sampleAudio() {
    if (this.isBlocked()) {
      this.reportStatus('cors-blocked');
      return null;
    }
    const analyser = this.getAnalyser();
    if (!analyser || !this.isPlaying()) {
      this.reportStatus(this.isPlaying() ? 'waiting' : 'paused');
      return null;
    }
    const count = analyser.frequencyBinCount;
    if (!this.freqData || this.freqData.length !== count) {
      this.freqData = new Uint8Array(count);
      this.timeData = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteFrequencyData(this.freqData);
    analyser.getByteTimeDomainData(this.timeData);

    // Compute real sub-bass & overall energy
    let bassSum = 0;
    const bassBins = Math.max(2, Math.min(10, Math.floor(count * 0.08)));
    for (let i = 1; i <= bassBins; i++) bassSum += this.freqData[i];
    const bass = bassSum / (bassBins * 255);

    let totalSum = 0;
    const usable = Math.floor(count * 0.65);
    for (let i = 1; i < usable; i++) totalSum += this.freqData[i];
    const avg = totalSum / (Math.max(1, usable - 1) * 255);

    // Smooth decay so motion stays fluid and calm
    this.bassEnergy = this.bassEnergy * 0.72 + bass * 0.28;
    this.energy = this.energy * 0.78 + avg * 0.22;

    // Bin into 48 logarithmic bands
    const n = this.smoothBins.length;
    for (let i = 0; i < n; i++) {
      const lo = Math.floor(Math.pow(i / n, 1.75) * usable) + 1;
      const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.75) * usable) + 1);
      let peak = 0;
      for (let b = lo; b < hi && b < count; b++) {
        if (this.freqData[b] > peak) peak = this.freqData[b];
      }
      const norm = peak / 255;
      const prev = this.smoothBins[i];
      this.smoothBins[i] = norm > prev ? prev * 0.55 + norm * 0.45 : prev * 0.86 + norm * 0.14;
    }

    this.reportStatus('active');
    return { freq: this.freqData, time: this.timeData, bins: this.smoothBins, bass: this.bassEnergy, energy: this.energy };
  }

  renderFrame() {
    const data = this.sampleAudio();
    if (!data) {
      // Smoothly decay visual energy to zero when paused or blocked
      let any = false;
      for (let i = 0; i < this.smoothBins.length; i++) {
        this.smoothBins[i] *= 0.84;
        if (this.smoothBins[i] > 0.004) any = true;
      }
      this.bassEnergy *= 0.85;
      this.energy *= 0.85;
      if (!any) { this.clear(); return; }
    }

    const palette = this.getPalette() || {};
    const accent = palette.color || '#1db954';

    // Always feed CSS variables for Artwork Glow and Ambient modes
    if (this.mode === 'glow' || this.mode === 'ambient' || this.mode === 'hills') {
      this.glowTarget?.style?.setProperty('--viz-bass', this.bassEnergy.toFixed(3));
      this.glowTarget?.style?.setProperty('--viz-energy', this.energy.toFixed(3));
      this.ambientTarget?.style?.setProperty('--viz-ambient', (this.energy * 0.75 + this.bassEnergy * 0.45).toFixed(3));
    }

    if (!this.ctx2d || !this.resizeIfNeeded()) return;
    const ctx = this.ctx2d;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);

    if (this.mode === 'glow') return; // Pure CSS aura on artwork

    if (this.mode === 'ambient') {
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.72, w * 0.05, w * 0.5, h * 0.72, Math.max(w, h) * (0.45 + this.bassEnergy * 0.35));
      grad.addColorStop(0, `${accent}${Math.round((0.18 + this.bassEnergy * 0.35) * 255).toString(16).padStart(2, '0')}`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      return;
    }

    if (this.mode === 'hills') {
      this.drawFluidHills(ctx, w, h, accent);
      return;
    }

    if (this.mode === 'spectrum') {
      this.drawSpectrum(ctx, w, h, accent);
      return;
    }

    if (this.mode === 'waveform' && this.timeData) {
      this.drawWaveform(ctx, w, h, accent);
      return;
    }

    if (this.mode === 'minimal') {
      this.drawMinimal(ctx, w, h, accent);
    }
  }

  /** Dual soft translucent spectrum hills mirrored around a kick mound in the center. */
  drawFluidHills(ctx, w, h, accent) {
    const bins = this.smoothBins;
    const count = 24;
    const mirrored = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.abs(i - (count - 1) / 2);
      const binIdx = Math.min(bins.length - 1, Math.floor((idx / (count / 2)) * 22));
      const kickBoost = idx < 3 ? Math.max(bins[binIdx], this.bassEnergy * 0.92) : bins[binIdx];
      mirrored.push(kickBoost);
    }

    const drawLayer = (scaleY, alpha, offsetPx, color) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, h);
      const step = w / (count - 1);
      for (let i = 0; i < count; i++) {
        const x = i * step;
        const y = h - Math.max(2, mirrored[i] * h * scaleY) - offsetPx;
        if (i === 0) ctx.lineTo(x, y);
        else {
          const prevX = (i - 1) * step;
          const prevY = h - Math.max(2, mirrored[i - 1] * h * scaleY) - offsetPx;
          ctx.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
        }
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, h * 0.15, 0, h);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    };

    drawLayer(0.68, 0.28 + this.energy * 0.22, h * 0.04, accent);
    drawLayer(0.46, 0.22 + this.bassEnergy * 0.34, 0, '#ffffff');
  }

  drawSpectrum(ctx, w, h, accent) {
    const count = 36;
    const gap = Math.max(2, Math.floor(w * 0.008));
    const barW = Math.max(2, (w - gap * (count + 1)) / count);
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, 'rgba(255,255,255,0.92)');
    ctx.fillStyle = grad;

    for (let i = 0; i < count; i++) {
      const v = this.smoothBins[Math.floor((i / count) * 40)] || 0;
      const barH = Math.max(4, v * h * 0.85);
      const x = gap + i * (barW + gap);
      const y = h - barH;
      const r = Math.min(barW / 2, barH / 2, 6);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barW, barH, r);
      else ctx.rect(x, y, barW, barH);
      ctx.fill();
    }
  }

  drawWaveform(ctx, w, h, accent) {
    const td = this.timeData;
    const step = Math.max(1, Math.floor(td.length / 96));
    ctx.save();
    ctx.lineWidth = Math.max(2, Math.round(h * 0.018));
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    let idx = 0;
    const pts = Math.floor(td.length / step);
    for (let i = 0; i < td.length; i += step) {
      const x = (idx / Math.max(1, pts - 1)) * w;
      const v = (td[i] - 128) / 128;
      const y = h * 0.5 + v * h * 0.38;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      idx++;
    }
    ctx.stroke();
    ctx.restore();
  }

  drawMinimal(ctx, w, h, accent) {
    const count = 12;
    const totalW = Math.min(w * 0.45, 220);
    const startX = (w - totalW) / 2;
    const gap = totalW / count;
    const barW = Math.max(3, gap * 0.48);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    for (let i = 0; i < count; i++) {
      const v = this.smoothBins[Math.floor((i / count) * 28)] || 0;
      const barH = Math.max(4, v * h * 0.55);
      const x = startX + i * gap;
      const y = h - barH - 8;
      ctx.fillStyle = i % 3 === 0 ? accent : 'rgba(255,255,255,0.82)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barW, barH, barW / 2);
      else ctx.rect(x, y, barW, barH);
      ctx.fill();
    }
  }
}
