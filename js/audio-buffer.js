// Hand off the same preloaded media element, even when only its beginning is ready.
export class NextAudioBuffer {
  constructor(createAudio = () => new Audio()) {
    this.spare = createAudio();
    this.spare.preload = 'none';
    // iOS Safari: keep media in-page so InstantPlay handoffs are not blocked.
    this.spare.playsInline = true;
    this.spare.setAttribute?.('playsinline', '');
    this.entry = null;
  }
  clear() {
    this.entry = null;
    this.spare.pause(); this.spare.removeAttribute('src'); this.spare.load(); this.spare.preload = 'none';
  }
  /** True when the warmed element can start without another network round-trip. */
  isReady(key, minReadyState = 2) {
    const entry = this.entry;
    if (entry?.key !== key || entry.media.error || Date.now() - entry.created > 480000) return false;
    return (entry.media.readyState || 0) >= minReadyState;
  }
  take(key) {
    const entry = this.entry;
    if (entry?.key !== key || entry.media.error || Date.now() - entry.created > 480000) return null;
    this.entry = null;
    return entry;
  }
  warm(key, source) {
    if (this.entry?.key === key && Date.now() - this.entry.created < 480000 && !this.entry.media.error) return;
    this.clear();
    this.entry = {key, source, created:Date.now(), media:this.spare};
    this.spare.playsInline = true;
    this.spare.setAttribute?.('playsinline', '');
    this.spare.preload = 'auto'; this.spare.src = source.url; this.spare.load();
  }
  recycle(media) {
    this.spare = media; this.clear();
  }
}
