// Background work yields whenever the current song needs network data.
// InstantPlay: thresholds for when to resolve vs attach the next track, and iOS AAC preference.
export function bufferedAhead(media) {
  const time = media.currentTime || 0;
  for (let i = 0; i < (media.buffered?.length || 0); i++) {
    if (media.buffered.start(i) <= time + .1 && media.buffered.end(i) > time) return media.buffered.end(i) - time;
  }
  return 0;
}
export function audioHasHeadroom(media, seconds = 8) {
  if (media.paused || !media.src || media.src.startsWith('data:')) return false;
  if (media.src.startsWith('blob:')) return true;
  const ahead = bufferedAhead(media);
  return ahead >= seconds || (ahead > .5 && Number.isFinite(media.duration) && media.duration - media.currentTime <= ahead + .25);
}
export function loopQuality(connection) {
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return 360;
  if (connection?.effectiveType === '3g' || (connection?.downlink > 0 && connection.downlink < 2)) return 480;
  // Fullscreen portrait crops a 16:9 video, so fast connections get 1080p for sharpness.
  if (connection?.downlink > 0 && connection.downlink < 6) return 720;
  return 1080;
}

/** iPhone/iPad Safari play Opus unreliably; InstantPlay always uses AAC there. */
export function prefersAac(ua = globalThis.navigator?.userAgent || '', platform = globalThis.navigator?.platform || '', touches = globalThis.navigator?.maxTouchPoints || 0) {
  return /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touches > 1);
}

/** Seconds of current-track buffer before attaching the next media element. */
export function mediaWarmHeadroom(connection = globalThis.navigator?.connection) {
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return 16;
  if (connection?.effectiveType === '3g' || (connection?.downlink > 0 && connection.downlink < 1.5)) return 10;
  return 6;
}

/** Keep a prepared next track across short pauses so skip/next stays instant. */
export const KEEP_WARM_AFTER_PAUSE_MS = 90_000;

/** Near the end, hand off a ready next element without waiting for 'ended' (iOS has no volume crossfade). */
export function seamlessHandoffWindow(media) {
  if (!media || media.paused || !Number.isFinite(media.duration) || media.duration <= 0) return false;
  const left = media.duration - media.currentTime;
  return left > 0.04 && left <= 0.35;
}
