// Can this audio URL be processed by Web Audio (reverb, pitch…)? That needs the server to allow
// cross-origin reads (CORS). Checked once per server with a 2-byte request, then remembered.
const verdicts = new Map();
export async function corsOK(url, fetcher = globalThis.fetch) {
  if (!url || /^(blob|data):/.test(url)) return true;
  let origin; try { origin = new URL(url).origin; } catch { return false; }
  if (globalThis.location && origin === globalThis.location.origin) return true;
  if (verdicts.has(origin)) return verdicts.get(origin);
  const check = (async () => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 2500);
    try { const r = await fetcher(url, {mode: 'cors', credentials: 'omit', headers: {Range: 'bytes=0-1'}, signal: ctl.signal}); r.body?.cancel?.(); return r.ok || r.status === 206; }
    catch { return false; } finally { clearTimeout(timer); }
  })();
  verdicts.set(origin, check);
  const ok = await check; verdicts.set(origin, ok); return ok;
}
export const knownCors = url => { try { const v = verdicts.get(new URL(url).origin); return typeof v === 'boolean' ? v : undefined; } catch { return undefined; } };
