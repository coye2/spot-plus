# Spot+ handoff (for Gemini, Cursor, Codex)

Last updated 2026-11-19, version 1.9.49. Research on Metrolist/NewPipe/ViMusic/OuterTune: docs/relay-research.md. Read this before changing playback.

## What Spot+ is
A music PWA (GitHub Pages: https://coye2.github.io/spot-plus/) plus a Cloudflare Worker
(`canvas-bridge/`, https://spot-plus-canvas.pwr97pnmkn.workers.dev). The owner plays it as an
iPhone home-screen app.

## Owner's non-negotiable rules
- No home PC/self-hosted server, no native app (IPA/APK/sideload), no required paid services.
- Full-length songs only: **no 30-second previews, no ads** (never use the YouTube embed player in Automatic).
- Real iPhone PWA playback: background audio, lock-screen controls, automatic queue advance, fast start.
- Don't break existing features. Don't claim something works until tested.
- Every fix: add an entry at the top of `js/changelog.js`, bump `package.json` version and the
  `SHELL_CACHE` name in `sw.js` (`spotplus-shell-vNN`), then `npm run changelog`.
- The owner deploys the worker himself (via his assistant Takumi, PowerShell):
  `cd $HOME\spot-plus; git pull; cd canvas-bridge; ..\node_modules\.bin\wrangler.cmd deploy`
  App changes go live on push (GitHub Pages).
- Maintenance mode is ON (`js/boot.js` `MAINTENANCE=true`, `js/maintenance.js` `MAINTENANCE_MODE`).
  Only turn it off when the owner says so.
- Do not use piracy sources (shared Tidal/Qobuz/Deezer accounts) or scraped private API keys.

## How audio works now (Spotube-style relay)
1. App asks the worker `/match?q=artist title` → ranked YouTube uploads.
2. App probes `/yta?id=<videoId>&fmt=aac|opus|low|low-opus` with `Range: bytes=0-1` (js/api.js `relayStream`).
   Probes are hedged: next upload starts after 1.5 s if the first hasn't answered; max 2 in flight.
3. The `<audio>` element plays the `/yta` URL directly. The worker (`canvas-bridge/youtube-relay.js`)
   gets a googlevideo link via InnerTube and streams it, stitching bounded slices
   (1 MB first, then 4 MB) into one response with exact Content-Length (Safari needs that).
4. SponsorBlock `music_offtopic` segments are skipped (`js/sponsorblock.js`, player `skipNonMusic`).

Key facts learned the hard way:
- YouTube client: **VISIONOS (id 101, v1.02)** is primary, **ANDROID_VR 1.43.32** the fallback (1.65.x gets
  SABR-only / refused since 2026-08-17); IOS needs a PO token and is not asked.
- The worker must not pass the incoming request's abort signal into upstream audio fetches: live in 1.9.48 that
  cut every stream after ~100 bytes. Lookups per song are capped (RESOLVE_BUDGET) under Cloudflare's 50 subrequests.
- Only one audio element may make sound: pause()/toggle() call silenceOthers() (1.9.49 fix for "paused but still playing"). Check yt-dlp's `yt_dlp/extractor/youtube/_base.py` when it breaks again.
- googlevideo links are tied to the requesting IP and refuse open-ended ranges → the worker must fetch
  in the same invocation, in bounded slices.
- Links can be cut off after the first chunk; the worker checks the last 2 bytes before using a link,
  and re-resolves once if a slice is refused mid-song.
- YouTube's bot check ("Sign in to confirm you're not a bot") still refuses some uploads at random;
  the app tries up to 3 uploads in 2 rounds. Not 100% guaranteed.
- Safari misreads the duration of YouTube's fragmented audio (shows 6-9 min). The player uses the
  match's real length for relay sources (`knownLength()` in js/player.js).

## Open issues (in priority order)
1. **Songs sometimes stop playing until the app is restarted (iPhone).** Cause not confirmed.
   Fixed suspects so far: /health failure disabled the relay for 5 min (1.9.40); a dropped relay
   stream made the app give up on the song (1.9.42 retries with another upload). Remaining suspect:
   the effects engine (`js/fx.js`) holding the audio element in a suspended AudioContext after
   background/interruption. Ask the owner what the screen shows when it happens.
2. Not yet verified on the owner's iPhone: 1.9.40–1.9.42 (song times, stuck playback), background
   playback + lock-screen controls + queue advance with the relay, SponsorBlock.
3. Skips are not always instant: check that the next track's relay probe is prewarmed (`prewarm` in js/api.js).
4. Backgrounds: phones get portrait Alpha Coders phone wallpapers (`device=phone` on `/wallpapers`,
   1.9.41, worker deployed). Not yet checked on a phone. Pinterest was declined (no public search API).
   Wallhaven (free official API with portrait filter) was offered as a second source.

## Testing
- `npm test` (265 tests) and `npx eslint js canvas-bridge`.
- Live worker check, Safari's request pattern: request `bytes=0-1`, then `bytes=0-`, and confirm
  the body length equals the Content-Range total.
- `scripts/smoke-playback.mjs`: end-to-end in Chrome (iPhone UA) against the live worker:
  `npm run build && node scripts/smoke-playback.mjs` (set `CHROME=` and `PLAYWRIGHT_CORE=` if needed;
  `DEBUG=1` logs network). The server must run on port 8080 (worker CORS allowlist). It has not had a
  full pass yet: the last run hit the dropped-stream bug fixed in 1.9.42.
