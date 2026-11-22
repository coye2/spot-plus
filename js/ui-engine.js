// ui-engine.js — Centralized Interface Manager & Design Token Controller.
// Switches cleanly between Original Spot+ and Spot+ UI without page reload,
// without reinitializing the audio player, and without interrupting playback.

export const UI_STYLES = Object.freeze({
  original: {
    id: 'original',
    name: 'Original Spot+',
    tagline: 'Classic Spot+ workspace, navigation, and player.',
  },
  spotplus: {
    id: 'spotplus',
    name: 'Spot+ UI',
    tagline: 'Liquid Glass surfaces, floating navigation, and immersive Apple Music-inspired player.',
  },
});

export const PLAYER_BACKGROUNDS = Object.freeze([
  { id: 'fluid', label: 'Fluid Art', desc: 'Slowly drifting blurred album artwork colors.' },
  { id: 'still', label: 'Blurred Art', desc: 'Calm frosted artwork backdrop.' },
  { id: 'loops', label: 'Animated Loops', desc: 'Canvas & music video loops over Fluid Art.' },
  { id: 'visualizer', label: 'Visualizer', desc: 'Audio-reactive spectrum hills over artwork.' },
  { id: 'solid', label: 'Solid / AMOLED', desc: 'Clean high-contrast solid surface.' },
]);

export const FONT_PAIRINGS = Object.freeze([
  { id: 'system', label: 'System SF / Inter', stack: '"Inter", -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif' },
  { id: 'rounded', label: 'Soft Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Inter", -apple-system, system-ui, sans-serif' },
  { id: 'editorial', label: 'Editorial Serif', stack: '"New York", ui-serif, Georgia, Cambria, serif' },
  { id: 'geometric', label: 'Clean Geometric', stack: '"Avenir Next", "Avenir", "Inter", -apple-system, sans-serif' },
  { id: 'mono', label: 'Studio Mono', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
]);

export const ANIMATION_LEVELS = Object.freeze(['full', 'subtle', 'reduced']);
export const LYRICS_SIZES = Object.freeze(['small', 'medium', 'large', 'xlarge']);
export const VISUALIZER_MODES = Object.freeze([
  { id: 'off', label: 'Off', desc: 'No live spectrum rendering.' },
  { id: 'hills', label: 'Fluid Hills', desc: 'Soft dual spectrum hills tinted by album art.' },
  { id: 'spectrum', label: 'Spectrum', desc: 'Smooth rounded frequency bars.' },
  { id: 'waveform', label: 'Waveform', desc: 'Fluid real-time oscilloscope wave.' },
  { id: 'ambient', label: 'Ambient', desc: 'Subtle audio-reactive backdrop glow.' },
  { id: 'glow', label: 'Artwork Glow', desc: 'Dynamic bass-reactive aura behind cover art.' },
  { id: 'minimal', label: 'Minimal', desc: 'Compact low-profile level bars.' },
]);

export const UI_DEFAULTS = Object.freeze({
  uiStyle: 'original',
  playerBg: 'fluid',
  fontChoice: 'system',
  artRadius: 14,
  glassIntensity: 72,
  blurIntensity: 26,
  animIntensity: 'full',
  visualizerMode: 'off',
  lyricsSize: 'medium',
  lyricsBlur: true,
  lyricsDelayMs: 0,
  lyricsTranslation: 'off', // 'off' | 'bilingual' | 'translated'
  lyricsTargetLang: 'en',
  tabBarLabels: false,
  playerDoubleTapSeek: true,
  playerHold2x: true,
});

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
};

export function normalizeUISettings(settings = {}) {
  const uiStyle = settings.uiStyle === 'spotplus' ? 'spotplus' : 'original';
  const playerBg = PLAYER_BACKGROUNDS.some((b) => b.id === settings.playerBg) ? settings.playerBg : UI_DEFAULTS.playerBg;
  const fontChoice = FONT_PAIRINGS.some((f) => f.id === settings.fontChoice) ? settings.fontChoice : UI_DEFAULTS.fontChoice;
  const animIntensity = settings.motion === 'reduced'
    ? 'reduced'
    : (ANIMATION_LEVELS.includes(settings.animIntensity) ? settings.animIntensity : UI_DEFAULTS.animIntensity);
  const visualizerMode = VISUALIZER_MODES.some((v) => v.id === settings.visualizerMode) ? settings.visualizerMode : UI_DEFAULTS.visualizerMode;
  const lyricsSize = LYRICS_SIZES.includes(settings.lyricsSize) ? settings.lyricsSize : UI_DEFAULTS.lyricsSize;
  const lyricsTranslation = ['off', 'bilingual', 'translated'].includes(settings.lyricsTranslation) ? settings.lyricsTranslation : 'off';
  const lyricsTargetLang = typeof settings.lyricsTargetLang === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(settings.lyricsTargetLang)
    ? settings.lyricsTargetLang : 'en';

  return {
    uiStyle,
    playerBg,
    fontChoice,
    artRadius: clamp(settings.artRadius, 0, 28, UI_DEFAULTS.artRadius),
    glassIntensity: clamp(settings.glassIntensity, 20, 100, UI_DEFAULTS.glassIntensity),
    blurIntensity: clamp(settings.blurIntensity, 4, 44, UI_DEFAULTS.blurIntensity),
    animIntensity,
    visualizerMode,
    lyricsSize,
    lyricsBlur: settings.lyricsBlur !== false,
    lyricsDelayMs: clamp(settings.lyricsDelayMs, -500, 1000, 0),
    lyricsTranslation,
    lyricsTargetLang,
    tabBarLabels: !!settings.tabBarLabels,
    playerDoubleTapSeek: settings.playerDoubleTapSeek !== false,
    playerHold2x: settings.playerHold2x !== false,
  };
}

const listeners = new Set();
let activeState = { ...UI_DEFAULTS };

export function onUIChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getUIState() {
  return { ...activeState };
}

/**
 * Apply interface style & design tokens directly onto the live DOM without touching
 * audio elements, playback state, or queue.
 */
export function applyUIEngine(settings = {}, { doc = globalThis.document, storage = globalThis.localStorage } = {}) {
  const next = normalizeUISettings(settings);
  const prevStyle = activeState.uiStyle;
  activeState = next;

  if (doc?.documentElement && doc?.body) {
    const root = doc.documentElement;
    const body = doc.body;
    const font = FONT_PAIRINGS.find((f) => f.id === next.fontChoice) || FONT_PAIRINGS[0];
    const glassAlpha = (0.28 + (next.glassIntensity / 100) * 0.48).toFixed(3);
    const glassBorderAlpha = (0.08 + (next.glassIntensity / 100) * 0.16).toFixed(3);
    const glassSpecAlpha = (0.10 + (next.glassIntensity / 100) * 0.22).toFixed(3);
    const animScale = next.animIntensity === 'reduced' ? '0' : next.animIntensity === 'subtle' ? '0.65' : '1';

    root.dataset.ui = next.uiStyle;
    body.dataset.ui = next.uiStyle;
    body.dataset.playerBg = next.playerBg;
    body.dataset.anim = next.animIntensity;
    body.dataset.lyricsSize = next.lyricsSize;
    body.dataset.lyricsBlur = next.lyricsBlur ? 'on' : 'off';
    body.dataset.tabLabels = next.tabBarLabels ? 'on' : 'off';

    root.style.setProperty('--sp-font', font.stack);
    root.style.setProperty('--sp-art-radius', `${next.artRadius}px`);
    root.style.setProperty('--sp-glass-blur', `${next.blurIntensity}px`);
    root.style.setProperty('--sp-glass-alpha', glassAlpha);
    root.style.setProperty('--sp-glass-border', `rgba(255,255,255,${glassBorderAlpha})`);
    root.style.setProperty('--sp-glass-spec', `rgba(255,255,255,${glassSpecAlpha})`);
    root.style.setProperty('--sp-anim-scale', animScale);
  }

  // Persist lightweight boot hint so first paint matches saved UI style with zero flicker.
  try {
    const prev = JSON.parse(storage?.getItem?.('spotplus.chrome') || '{}') || {};
    storage?.setItem?.('spotplus.chrome', JSON.stringify({ ...prev, uiStyle: next.uiStyle }));
  } catch { /* private mode */ }

  listeners.forEach((fn) => {
    try { fn(next, { styleChanged: prevStyle !== next.uiStyle }); } catch (err) { console.error(err); }
  });

  return next;
}
