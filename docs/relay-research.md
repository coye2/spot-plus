# Spot+ YouTube Relay: what four open-source YouTube music apps do, and what Spot+ can use

Checked 2026-11-19. Sources: each project's GitHub repository. InnerTubeX was cloned and read;
the others were checked for license and status.

## The honest summary
All four apps get their audio from the same place Spot+ does: YouTube's internal player API
(InnerTube) and its googlevideo servers. They are not four independent music providers, and adding
"a Metrolist engine" or "a NewPipe engine" next to the Spot+ relay would just ask the same YouTube
servers the same question a second time. What they offer is technique, not a new source.

All four are **GPL-3.0** (Metrolist, InnerTubeX, NewPipeExtractor, ViMusic, OuterTune). Spot+ does not
copy their code. It only uses facts about YouTube's API that they document (client names, versions,
which ones work).

They are Android/JVM apps (Kotlin/Java). None of them runs in Safari or in a Cloudflare Worker, so
using one as a backend would mean a server Spot+ doesn't have (ruled out: no home PC, no paid
servers).

## Metrolist / InnerTubeX (most useful, actively maintained: last commit 2026-11-17)
- **App identity choice ("client director").** It tries several YouTube app identities in an order
  that depends on the content, with a time budget across all of them. Spot+ now does the same in
  miniature: VISIONOS first, then ANDROID_VR. The worker caps lookups per song (24 of Cloudflare's 50
  subrequests) so the audio itself always fits.
- **ANDROID_VR version.** InnerTubeX notes that ANDROID_VR versions above 1.65 can return SABR-only
  streams, and uses **1.43.32**. Spot+ was on 1.65.10, which YouTube has refused since 2026-08-17;
  it now uses 1.43.32 as the fallback. *Adopted in 1.9.49.*
- **SABR/UMP streaming.** YouTube's newer streaming protocol: the player asks for media segments
  in a binary protocol and gets them back framed. InnerTubeX implements it (SabrAudioStream,
  UmpReader). It is not practical for Spot+ today. An `<audio>` element can't play it; it would need
  MediaSource with segment parsing in the page, plus a worker that speaks the protocol. iPhone's
  MediaSource support (ManagedMediaSource) is newer and stricter. Worth revisiting only if YouTube
  stops serving plain links to every client.
- **PO tokens** (proof-of-origin tokens that some clients need). They need YouTube's BotGuard
  JavaScript run in a real browser. Spot+ avoids clients that need them.

## NewPipe / NewPipeExtractor
A Java library. It can't run in a Worker or a browser. Its techniques (client fallback, format
selection) overlap with InnerTubeX's and yt-dlp's, which Spot+ already follows.

## ViMusic
Largely unmaintained; its forks moved on. Its ideas (YouTube Music search, persistent queue, chunk
caching on the phone) are covered by Spot+ already or need native storage access.

## OuterTune
Its playback path is InnerTune-style InnerTube calls, the same as above. Audio normalization uses
ExoPlayer's loudness data on Android; there's no equivalent for Spot+'s `<audio>` element without
the Web Audio path, which iPhone suspends in the background.

## What this means for a "multi-engine" relay
A second engine only helps if it can succeed when the first fails. Every candidate here ends at the
same YouTube servers with the same bot checks, so the real levers are:
1. which app identities are asked, and in what order (done);
2. failing fast on refused uploads, so another upload can be tried (done: about 2 s instead of 10–15);
3. trying other uploads of the same song (done, in the app);
4. falling back to a different provider, which Automatic already does (HiFi/Monochrome, JioSaavn).
Building an engine framework with only one real engine in it would add complexity without adding
reliability, so Spot+ doesn't have one.

## Limits that remain
YouTube can change or block any of this at any time, and it rate-limits cloud addresses with "Sign
in to confirm you're not a bot". No technique here guarantees access.
