// predictive-pipeline.js — Predictive Queue Analyzer, Skip-Velocity Guard, and Dual-Player Coordinator.

export function predictUpcoming({ queue = [], index = -1, repeat = 'off' } = {}) {
  if (!Array.isArray(queue) || !queue.length || index < 0) return [];
  if (repeat === 'one') return [];
  const targets = [];
  const firstIdx = index + 1 < queue.length ? index + 1 : (repeat === 'all' ? 0 : -1);
  if (firstIdx >= 0 && queue[firstIdx] && !queue[firstIdx].local) {
    targets.push({ track: queue[firstIdx], index: firstIdx, stage: 'B' });
    const secondIdx = firstIdx + 1 < queue.length ? firstIdx + 1 : (repeat === 'all' ? 0 : -1);
    if (secondIdx >= 0 && secondIdx !== firstIdx && secondIdx !== index && queue[secondIdx] && !queue[secondIdx].local) {
      targets.push({ track: queue[secondIdx], index: secondIdx, stage: 'A' });
    }
  }
  return targets;
}

export class SkipTracker {
  constructor({ windowMs = 12_000, threshold = 3 } = {}) {
    this.windowMs = windowMs;
    this.threshold = threshold;
    this.events = [];
  }

  record(now = Date.now()) {
    this.events.push(now);
    const cutoff = now - this.windowMs;
    this.events = this.events.filter(t => t >= cutoff);
  }

  isRapidSkipping(now = Date.now()) {
    const cutoff = now - this.windowMs;
    this.events = this.events.filter(t => t >= cutoff);
    return this.events.length >= this.threshold;
  }

  stageBDelayMs(now = Date.now()) {
    return this.isRapidSkipping(now) ? 900 : 180;
  }

  clear() {
    this.events = [];
  }
}

export class ActivationTracker {
  constructor() {
    this.unlocked = new WeakSet();
    this.autoAdvanceBlocked = false;
  }

  isUnlocked(media) {
    return !!(media && this.unlocked.has(media));
  }

  markUnlocked(media) {
    if (media) this.unlocked.add(media);
  }

  noteAutoAdvanceSuccess() {
    this.autoAdvanceBlocked = false;
  }

  noteAutoAdvanceBlocked() {
    this.autoAdvanceBlocked = true;
  }
}
