// A bounded, disposable next-song buffer; never persisted as a download.
export class NextAudioBuffer {
  constructor(fetcher = (...args) => fetch(...args), limit = 16 * 1024 * 1024) { this.fetcher = fetcher; this.limit = limit; this.entry = null; }
  clear() { this.entry?.controller.abort(); this.entry = null; }
  take(key) {
    const entry = this.entry;
    if (entry?.key !== key || !entry.blob || Date.now() - entry.created > 5 * 60000) return null;
    this.entry = null;
    return { blob: entry.blob, source: entry.source };
  }
  async warm(key, source) {
    if (this.entry?.key === key) return;
    this.clear();
    const entry = { key, source, created: Date.now(), controller: new AbortController(), blob: null };
    this.entry = entry;
    const timer = setTimeout(() => entry.controller.abort(), 20000);
    try {
      const response = await this.fetcher(source.url, { signal: entry.controller.signal });
      if (!response.ok || Number(response.headers.get('content-length')) > this.limit || !response.body?.getReader) throw new Error('Not bufferable');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.limit) { await reader.cancel(); throw new Error('Buffer limit'); }
        chunks.push(value);
      }
      if (this.entry === entry && !entry.controller.signal.aborted && size > 0) entry.blob = new Blob(chunks, { type: source.mime?.split(';')[0] || response.headers.get('content-type') || 'audio/mpeg' });
    } catch { if (this.entry === entry) this.clear(); }
    finally { clearTimeout(timer); }
  }
}
