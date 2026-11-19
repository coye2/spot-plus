// Shared HTTP range validation for the Spot+ audio relay.
// Never trust a 200 response or a 206 that does not match the bytes requested.
export function parseRequestRange(value) {
  if (value == null || value === '') return {start: 0, end: null};
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0 ? {suffix} : null;
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? null : Number(match[2]);
  if (!Number.isSafeInteger(start) || start < 0 ||
      (end !== null && (!Number.isSafeInteger(end) || end < start))) return null;
  return {start, end};
}

export function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(String(value || '').trim());
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) ||
      start < 0 || end < start || end >= total) return null;
  return {start, end, total, length: end - start + 1};
}

export function validateUpstreamRange(response, from, to, expectedTotal = 0) {
  if (response?.status !== 206) return null;
  const span = parseContentRange(response.headers.get('Content-Range'));
  if (!span || span.start !== from || span.end !== Math.min(to, span.total - 1)) return null;
  if (expectedTotal && span.total !== expectedTotal) return null;
  const declared = response.headers.get('Content-Length');
  if (declared != null && (Number(declared) !== span.length || !Number.isSafeInteger(Number(declared)))) return null;
  return span;
}

export function resolveRequestRange(want, total) {
  if (!want || !Number.isSafeInteger(total) || total <= 0) return null;
  if (want.suffix !== undefined) return {start: Math.max(0, total - want.suffix), end: total - 1};
  if (want.start >= total) return null;
  return {start: want.start, end: Math.min(want.end ?? total - 1, total - 1)};
}
