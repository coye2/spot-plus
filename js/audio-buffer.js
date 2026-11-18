// Hand off the same preloaded media element (Player B), even when only its beginning is ready.
export class NextAudioBuffer {
  constructor(createAudio = () => new Audio()) {
    this.spare = createAudio();
    this.spare.preload = 'none';
    this.spare.playsInline = true;
    this.spare.setAttribute?.('playsinline', '');
    this.entry = null;
  }
  clear() {
    this.entry = null;
    this.spare.pause();
    this.spare.removeAttribute('src');
    this.spare.removeAttribute?.('crossorigin');
    this.spare.load();
    this.spare.preload = 'none';
  }
  /** True when the warmed element can start without another network round-trip. */
  isReady(key, minReadyState = 2) {
    const e = this.entry;
    return !!(e && e.key === key && !e.media.error && (e.media.readyState || 0) >= minReadyState && Date.now() - e.created <= 480000);
  }
  take(key) {
    const entry = this.entry;
    if (entry?.key !== key || entry.media.error || Date.now() - entry.created > 480000) return null;
    this.entry = null;
    return entry;
  }
  warm(key, source, { cors = false } = {}) {
    if (!source?.url) return;
    if (this.entry?.key === key && this.entry?.source?.url === source.url && !this.entry.media.error && Date.now() - this.entry.created < 480000) return;
    this.clear();
    this.entry = { key, source, created: Date.now(), media: this.spare };
    this.spare.playsInline = true;
    this.spare.setAttribute?.('playsinline', '');
    if (cors) this.spare.crossOrigin = 'anonymous';
    else this.spare.removeAttribute?.('crossorigin');
    this.spare.preload = 'auto';
    this.spare.src = source.url;
    this.spare.load();
  }
  recycle(media) {
    this.spare = media;
    this.spare.playsInline = true;
    this.spare.setAttribute?.('playsinline', '');
    this.clear();
  }
}
