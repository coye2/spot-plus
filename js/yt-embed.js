// yt-embed.js — Embedded YouTube player fallback for when public Piped/Invidious servers are unavailable.
const YT_ORIGINS = new Set(['https://www.youtube.com', 'https://www.youtube-nocookie.com']);

export class YouTubeEmbedPlayer {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.active = false;
    this.ready = false;
    this.paused = true;
    this.needsTap = false;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 1;
    this.candidates = [];
    this.candidateIndex = 0;
    this.videoId = '';
    this.startAt = 0;
    this.autoplay = true;
    this.iframe = null;
    this.tapTimer = null;
    this.loadTimer = null;
    this.pollTimer = null;
    this.gen = 0;
    this.endedGen = 0;
    // A booted player swaps songs in place (no page reload), which is what makes InstantPlay instant.
    this.live = false;
    this.warming = false;
    // A second, hidden player holds the next song cued, so starting it is a swap, not a load.
    this.spare = null;
    this.spareLive = false;
    this.spareId = '';
    this.cuedId = '';
    this._onMessage = (e) => this.handleMessage(e);
    if (typeof globalThis.window?.addEventListener === 'function') {
      globalThis.window.addEventListener('message', this._onMessage);
    }
  }

  ensureFrame() {
    if (this.iframe) return this.iframe;
    const host = globalThis.document?.getElementById?.('ytEmbedBox');
    const iframe = globalThis.document?.createElement?.('iframe');
    if (!iframe) return null;
    iframe.className = 'yt-embed-frame';
    iframe.title = 'YouTube audio player';
    iframe.setAttribute?.('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.setAttribute?.('allowfullscreen', '');
    iframe.addEventListener?.('load', () => {
      if (!this.active) return;
      this.sendListening();
    });
    if (host && iframe.parentNode !== host) { if (host.prepend) host.prepend(iframe); else host.replaceChildren?.(iframe); }
    this.iframe = iframe;
    return iframe;
  }

  post(payload) {
    try {
      this.iframe?.contentWindow?.postMessage(JSON.stringify(payload), 'https://www.youtube.com');
    } catch { /* cross-origin frame not ready yet */ }
  }

  sendListening() {
    this.post({ event: 'listening', id: 1, channel: 'widget' });
    this.post({ event: 'command', func: 'addEventListener', args: ['onReady'] });
    this.post({ event: 'command', func: 'addEventListener', args: ['onStateChange'] });
    this.post({ event: 'command', func: 'addEventListener', args: ['onError'] });
  }

  embedSrc(id, autoplay, startAt) {
    const origin = /^https?:/.test(globalThis.location?.origin || '') ? `&origin=${encodeURIComponent(globalThis.location.origin)}` : '';
    const start = startAt > 1 ? `&start=${Math.floor(startAt)}` : '';
    return `https://www.youtube.com/embed/${encodeURIComponent(id)}?enablejsapi=1&autoplay=${autoplay ? 1 : 0}&playsinline=1&rel=0&modestbranding=1${start}${origin}`;
  }

  /** iPhone blocks sound until someone taps YouTube's own button once; ask for that tap if nothing starts. */
  armTap(gen, ms) {
    clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      if (gen !== this.gen || !this.active || !this.paused || !this.autoplay) return;
      this.needsTap = true;
      this.hooks.onNeedsTap?.(true);
    }, ms);
    this.tapTimer.unref?.();
  }

  clearTimers() {
    clearTimeout(this.tapTimer); this.tapTimer = null;
    clearTimeout(this.loadTimer); this.loadTimer = null;
    clearInterval(this.pollTimer); this.pollTimer = null;
  }

  load(ids, { startAt = 0, autoplay = true, volume = 1 } = {}) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(id => /^[\w-]{11}$/.test(String(id || ''))))];
    if (!list.length) {
      this.hooks.onError?.('No matching YouTube recording');
      return false;
    }
    const gen = ++this.gen;
    this.clearTimers();
    if (this.spare && this.spareLive && this.spareId && this.spareId === list[0] && this.iframe) this.swapToSpare();
    this.active = true;
    this.ready = false;
    this.paused = true;
    this.needsTap = false;
    this.currentTime = startAt || 0;
    this.duration = 0;
    this.volume = volume;
    this.candidates = list;
    this.candidateIndex = 0;
    this.startAt = startAt || 0;
    this.autoplay = autoplay;
    this.mountCandidate(gen);
    return true;
  }

  mountCandidate(gen) {
    if (gen !== this.gen || !this.active) return;
    this.clearTimers();
    this.videoId = this.candidates[this.candidateIndex];
    this.ready = false;
    const frame = this.ensureFrame();
    if (!frame) {
      this.hooks.onError?.('Player frame unavailable');
      return;
    }
    if (this.live && !this.warming && this.cuedId === this.videoId) {
      // The hidden player already holds this song: start it (and jump if resuming mid-song).
      this.cuedId = '';
      if (this.startAt > 1) this.post({event: 'command', func: 'seekTo', args: [Math.floor(this.startAt), true]});
      this.post({event: 'command', func: 'setVolume', args: [Math.round(this.volume * 100)]});
      if (this.autoplay) { this.post({event: 'command', func: 'playVideo', args: []}); this.armTap(gen, 2200); }
      this.ready = true;
      this.hooks.onReady?.();
      this.loadTimer = setTimeout(() => {
        if (gen !== this.gen || !this.active || !this.paused || !this.autoplay) return;
        // The cued song did not start: load it normally in this player.
        this.post({event: 'command', func: 'loadVideoById', args: [{videoId: this.videoId, startSeconds: Math.max(0, Math.floor(this.startAt))}]});
      }, 2500);
      this.loadTimer.unref?.();
      return;
    }
    if (this.live && !this.warming) {
      // Swap the song inside the running player: about a third of a second instead of a full reload.
      this.post({event: 'command', func: 'unMute', args: []});
      this.post({event: 'command', func: this.autoplay ? 'loadVideoById' : 'cueVideoById', args: [{videoId: this.videoId, startSeconds: Math.max(0, Math.floor(this.startAt))}]});
      this.post({event: 'command', func: 'setVolume', args: [Math.round(this.volume * 100)]});
      if (this.autoplay) this.armTap(gen, 2200);
      this.loadTimer = setTimeout(() => {
        // The hot swap did not answer: fall back to a fresh player for this song.
        if (gen !== this.gen || !this.active || this.ready) return;
        this.live = false;
        this.mountCandidate(gen);
      }, 2500);
      this.loadTimer.unref?.();
      return;
    }
    this.warming = false;
    frame.src = this.embedSrc(this.videoId, this.autoplay, this.startAt);
    this.pollTimer = setInterval(() => {
      if (gen === this.gen && this.active && !this.ready) this.sendListening();
    }, 350);
    this.pollTimer.unref?.();
    this.loadTimer = setTimeout(() => {
      if (gen !== this.gen || !this.active || this.ready) return;
      if (!this.tryNextCandidate(gen)) this.hooks.onError?.('YouTube player did not answer');
    }, 7000);
    this.loadTimer.unref?.();
  }

  tryNextCandidate(gen) {
    if (gen !== this.gen || !this.active) return false;
    if (this.candidateIndex + 1 < this.candidates.length) {
      this.candidateIndex++;
      this.mountCandidate(gen);
      return true;
    }
    return false;
  }

  handleMessage(e) {
    if (!YT_ORIGINS.has(e.origin)) return;
    let data;
    try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!data || typeof data !== 'object') return;
    if (this.spare && e.source && e.source === this.spare.contentWindow) { this.handleSpare(data); return; }
    if (this.iframe && e.source && e.source !== this.iframe.contentWindow) return;
    if (data.event === 'onReady' || data.event === 'initialDelivery' || data.event === 'infoDelivery') { this.live = true; this.warming = false; }
    if (!this.active) return;
    const gen = this.gen;
    if (data.event === 'onReady' || data.event === 'initialDelivery') {
      const wasReady = this.ready;
      this.ready = true;
      clearTimeout(this.loadTimer);
      clearInterval(this.pollTimer);
      if (!wasReady) {
        this.setVolume(this.volume);
        if (this.startAt > 1) this.seek(this.startAt);
        if (this.autoplay) { this.play(); this.armTap(gen, 1600); }
        this.hooks.onReady?.();
      }
    }
    if (data.event === 'infoDelivery' && data.info) {
      const info = data.info;
      if (!this.ready) {
        this.ready = true;
        clearTimeout(this.loadTimer);
        clearInterval(this.pollTimer);
        this.setVolume(this.volume);
        if (this.autoplay) { this.play(); this.armTap(gen, 1600); }
        this.hooks.onReady?.();
      }
      if (typeof info.duration === 'number' && info.duration > 0) this.duration = info.duration;
      if (typeof info.currentTime === 'number') {
        this.currentTime = info.currentTime;
        this.hooks.onTime?.(this.currentTime);
      }
      if (typeof info.playerState === 'number') this.handleState(info.playerState, gen);
    }
    if (data.event === 'onStateChange' && typeof data.info === 'number') {
      this.handleState(data.info, gen);
    }
    if (data.event === 'onError') {
      this.hooks.onCandidateError?.(this.videoId, Number(data.info) || 0);
      if (!this.tryNextCandidate(gen)) this.hooks.onError?.(`YouTube playback unavailable (${data.info || 'error'})`);
    }
  }

  handleState(st, gen) {
    if (gen !== this.gen || !this.active) return;
    if (st === 1) {
      const wasPaused = this.paused;
      this.paused = false;
      this.needsTap = false;
      clearTimeout(this.tapTimer);
      this.hooks.onNeedsTap?.(false);
      if (wasPaused) this.hooks.onPlaying?.();
    } else if (st === 2) {
      const wasPlaying = !this.paused;
      this.paused = true;
      if (wasPlaying) this.hooks.onPause?.();
    } else if (st === 0) {
      this.paused = true;
      clearTimeout(this.tapTimer);
      if (this.endedGen === gen) return;
      this.endedGen = gen;
      this.hooks.onEnded?.();
    } else if (st === 3 && this.ready && this.autoplay) {
      clearTimeout(this.tapTimer);
      this.tapTimer = setTimeout(() => {
        if (gen !== this.gen || !this.active || !this.paused) return;
        this.needsTap = true;
        this.hooks.onNeedsTap?.(true);
      }, 3000);
      this.tapTimer.unref?.();
    }
  }

  play() {
    if (!this.active) return;
    this.autoplay = true;
    this.post({ event: 'command', func: 'playVideo', args: [] });
  }

  pause() {
    if (!this.active) return;
    this.autoplay = false;
    const wasPlaying = !this.paused;
    this.paused = true;
    this.post({ event: 'command', func: 'pauseVideo', args: [] });
    if (wasPlaying) this.hooks.onPause?.();
  }

  seek(sec) {
    if (!this.active) return;
    this.currentTime = Math.max(0, Number(sec) || 0);
    this.post({ event: 'command', func: 'seekTo', args: [this.currentTime, true] });
    this.hooks.onTime?.(this.currentTime);
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.active) this.post({ event: 'command', func: 'setVolume', args: [Math.round(this.volume * 100)] });
  }

  stop() {
    ++this.gen;
    this.clearTimers();
    this.active = false;
    this.ready = false;
    this.paused = true;
    this.needsTap = false;
    this.currentTime = 0;
    this.duration = 0;
    if (this.live) this.post({ event: 'command', func: 'stopVideo', args: [] });
    else if (this.iframe && !this.warming) this.iframe.src = 'about:blank';
  }

  /** Cue a likely next song in the hidden player (no sound). Blocked uploads are found here, before playback. */
  preload(id) {
    if (!/^[\w-]{11}$/.test(String(id || '')) || id === this.spareId || (this.active && id === this.videoId)) return false;
    const host = globalThis.document?.getElementById?.('ytEmbedBox');
    if (!host || !this.live) return false;
    this.spareId = id;
    if (!this.spare) {
      const frame = globalThis.document.createElement('iframe');
      frame.className = 'yt-embed-frame yt-spare';
      frame.title = 'YouTube audio player (next song)';
      frame.setAttribute?.('allow', 'autoplay; encrypted-media; picture-in-picture');
      frame.setAttribute?.('aria-hidden', 'true');
      frame.tabIndex = -1;
      if (host.append) host.append(frame); else host.appendChild?.(frame);
      this.spare = frame;
      this.spareLive = false;
    }
    if (this.spareLive) {
      this.postTo(this.spare, {event: 'command', func: 'cueVideoById', args: [{videoId: id, startSeconds: 0}]});
    } else {
      this.spare.src = this.embedSrc(id, false, 0);
      const frame = this.spare;
      const ping = setInterval(() => { if (this.spare !== frame || this.spareLive) clearInterval(ping); else this.listenOn(frame); }, 400);
      ping.unref?.();
      setTimeout(() => clearInterval(ping), 9000)?.unref?.();
    }
    return true;
  }

  handleSpare(data) {
    if (data.event === 'onReady' || data.event === 'initialDelivery' || data.event === 'infoDelivery') this.spareLive = true;
    if (data.event === 'onError') {
      // Found a blocked upload before anyone pressed play.
      this.hooks.onCandidateError?.(this.spareId, Number(data.info) || 0);
      this.spareId = '';
    }
  }

  swapToSpare() {
    const old = this.iframe, next = this.spare, id = this.spareId;
    if (old) {
      this.postTo(old, {event: 'command', func: 'stopVideo', args: []});
      old.classList?.add('yt-spare');
    }
    next.classList?.remove('yt-spare');
    this.iframe = next;
    this.spare = old;
    this.spareLive = this.live;
    this.live = true;
    this.spareId = '';
    this.cuedId = id;
  }

  postTo(frame, payload) {
    try { frame?.contentWindow?.postMessage(JSON.stringify(payload), 'https://www.youtube.com'); } catch { /* not ready */ }
  }

  listenOn(frame) {
    this.postTo(frame, { event: 'listening', id: 2, channel: 'widget' });
    for (const ev of ['onReady', 'onStateChange', 'onError']) this.postTo(frame, { event: 'command', func: 'addEventListener', args: [ev] });
  }

  /** Boot the player in the background with a song cued (no sound), so the first tap starts at once. */
  warm(id) {
    if (this.active || this.live || this.warming || !/^[\w-]{11}$/.test(String(id || ''))) return false;
    const frame = this.ensureFrame();
    if (!frame) return false;
    this.warming = true;
    frame.src = this.embedSrc(id, false, 0);
    const ping = setInterval(() => { if (this.live || !this.warming) clearInterval(ping); else this.sendListening(); }, 400);
    ping.unref?.();
    setTimeout(() => { clearInterval(ping); if (!this.live) this.warming = false; }, 9000)?.unref?.();
    return true;
  }
}
