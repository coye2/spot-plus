// Background work yields whenever the current song needs network data.
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
  return 720;
}
