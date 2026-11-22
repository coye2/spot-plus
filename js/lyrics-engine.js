// lyrics-engine.js — Enhanced LRC parser (true word-level & line-level sync),
// Bluetooth timing delay adjustment, and optional client-side lyrics translation.
// Never fabricates word timestamps when only line timestamps are available.

const WORD_TAG_RE = /<(\d{1,3}):(\d{2}(?:\.\d{1,3})?)>/g;
const LINE_TAG_RE = /\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;

const toSeconds = (min, sec) => Number(min) * 60 + Number(sec);

/**
 * Parse LRC or Enhanced LRC (with <mm:ss.xx> inline word tags).
 * Returns sorted array of { t, text, words: Array<{ t, text }> | null }.
 * `words` is strictly null unless genuine inline word timestamps exist in the source.
 */
export function parseEnhancedLRC(rawText) {
  const out = [];
  for (const rawLine of String(rawText || '').split(/\r?\n/)) {
    const lineTags = [...rawLine.matchAll(LINE_TAG_RE)];
    if (!lineTags.length) continue;
    const body = rawLine.replace(LINE_TAG_RE, '').trim();
    const wordMatches = [...body.matchAll(WORD_TAG_RE)];

    if (wordMatches.length >= 2) {
      // Genuine enhanced LRC with real word-level timing
      const words = [];
      for (let i = 0; i < wordMatches.length; i++) {
        const m = wordMatches[i];
        const start = m.index + m[0].length;
        const end = i + 1 < wordMatches.length ? wordMatches[i + 1].index : body.length;
        const chunk = body.slice(start, end);
        if (chunk.trim()) {
          words.push({
            t: toSeconds(m[1], m[2]),
            text: chunk,
          });
        }
      }
      const plainText = words.map((w) => w.text).join('').replace(/\s+/g, ' ').trim();
      for (const lt of lineTags) {
        out.push({
          t: toSeconds(lt[1], lt[2]),
          text: plainText,
          words: words.length ? words : null,
        });
      }
    } else {
      // Standard line-level LRC: strip any stray tags, keep words === null (never fabricate!)
      const clean = body.replace(WORD_TAG_RE, '').trim();
      for (const lt of lineTags) {
        out.push({
          t: toSeconds(lt[1], lt[2]),
          text: clean,
          words: null,
        });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** True if at least one line has genuine word-level timestamps. */
export function hasWordTiming(lines) {
  return Array.isArray(lines) && lines.some((l) => Array.isArray(l?.words) && l.words.length > 0);
}

/**
 * Resolve active line index and active word index (if genuine word timestamps exist)
 * accounting for user's timing offset (e.g. Bluetooth audio delay in ms).
 */
export function resolveActiveLyric(lines, positionSec, { delayMs = 0, lookaheadSec = 0.2 } = {}) {
  if (!Array.isArray(lines) || !lines.length) return { lineIndex: -1, wordIndex: -1 };
  const effectivePos = (Number(positionSec) || 0) - (Number(delayMs) || 0) / 1000 + lookaheadSec;
  let nextIdx = lines.findIndex((l) => l.t > effectivePos);
  const lineIndex = (nextIdx === -1 ? lines.length : nextIdx) - 1;
  if (lineIndex < 0) return { lineIndex: -1, wordIndex: -1 };

  const activeLine = lines[lineIndex];
  if (!Array.isArray(activeLine?.words) || !activeLine.words.length) {
    return { lineIndex, wordIndex: -1 };
  }
  const wordPos = (Number(positionSec) || 0) - (Number(delayMs) || 0) / 1000;
  let nextWord = activeLine.words.findIndex((w) => w.t > wordPos);
  const wordIndex = (nextWord === -1 ? activeLine.words.length : nextWord) - 1;
  return { lineIndex, wordIndex };
}

/* ---------------- Optional Client-Side Lyrics Translation ----------------
   Uses a public client-side translation endpoint with local in-memory cache.
   Zero Cloudflare Worker traffic, zero exposed secrets, graceful fallback offline. */
const translationCache = new Map();

export const TRANSLATION_LANGS = Object.freeze([
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'zh', label: 'Chinese' },
]);

export async function translateLines(lines, targetLang = 'en', { fetchImpl = globalThis.fetch, signal } = {}) {
  if (!Array.isArray(lines) || !lines.length || typeof fetchImpl !== 'function') return null;
  const cleanLang = String(targetLang || 'en').slice(0, 5);
  const texts = lines.map((l) => String(l?.text || '').trim());
  const nonEmptyIdx = texts.map((t, idx) => (t ? idx : -1)).filter((i) => i >= 0);
  if (!nonEmptyIdx.length) return null;

  const cacheKey = `${cleanLang}:${texts.slice(0, 6).join('|')}:${texts.length}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

  // Batch into <= 24 lines per request to keep URLs short and fast
  const translated = new Array(lines.length).fill('');
  const BATCH = 24;
  try {
    for (let start = 0; start < nonEmptyIdx.length; start += BATCH) {
      const sliceIdx = nonEmptyIdx.slice(start, start + BATCH);
      const joined = sliceIdx.map((i) => texts[i]).join('\n');
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(cleanLang)}&dt=t&q=${encodeURIComponent(joined)}`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const combined = Array.isArray(data?.[0]) ? data[0].map((seg) => seg?.[0] || '').join('') : '';
      const outLines = combined.split('\n');
      sliceIdx.forEach((origIdx, k) => {
        const candidate = (outLines[k] || '').trim();
        // Skip identical lines so English songs don't show duplicate subtitles
        translated[origIdx] = candidate && candidate.toLowerCase() !== texts[origIdx].toLowerCase() ? candidate : '';
      });
    }
    if (translationCache.size > 40) translationCache.delete(translationCache.keys().next().value);
    translationCache.set(cacheKey, translated);
    return translated;
  } catch {
    return null;
  }
}
