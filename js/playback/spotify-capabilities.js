// js/playback/spotify-capabilities.js
// Real runtime capability detection for official Spotify Web Playback SDK (EME/DRM)
// and Spotify Connect remote control across Desktop, Android, iOS Safari, and iOS PWA.

const EME_SYSTEMS = [
  { id: 'widevine', keySystem: 'com.widevine.alpha', audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] },
  { id: 'fairplay', keySystem: 'com.apple.fps.1_0', audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] },
  { id: 'playready', keySystem: 'com.microsoft.playready', audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] },
];

export function parsePlatformInfo(nav = globalThis.navigator, win = globalThis.window) {
  const ua = String(nav?.userAgent || '');
  const maxTouch = Number(nav?.maxTouchPoints) || 0;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouch > 1);
  const isAndroid = /Android/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|FxiOS|Firefox/i.test(ua);
  const isStandalone = !!(
    nav?.standalone
    || (typeof win?.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches)
  );
  const isSecureContext = win?.isSecureContext !== false;
  const hasCryptoSubtle = !!(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues);
  return {
    ua,
    isIOS,
    isAndroid,
    isSafari,
    isStandalone,
    isIOSPWA: isIOS && isStandalone,
    isSecureContext,
    hasCryptoSubtle,
  };
}

/**
 * Probe Encrypted Media Extensions (EME) required by Spotify's official Web Playback SDK.
 * Never claims Web Playback SDK compatibility without checking EME and iOS WebKit limits.
 */
export async function detectSpotifyCapabilities({
  nav = globalThis.navigator,
  win = globalThis.window,
} = {}) {
  const platform = parsePlatformInfo(nav, win);
  const supportedKeySystems = [];

  if (typeof nav?.requestMediaKeySystemAccess === 'function' && platform.isSecureContext) {
    for (const sys of EME_SYSTEMS) {
      try {
        await nav.requestMediaKeySystemAccess(sys.keySystem, [{
          initDataTypes: ['cenc', 'sinf', 'skd'],
          audioCapabilities: sys.audioCapabilities,
        }]);
        supportedKeySystems.push(sys.id);
      } catch {
        // Key system unavailable on this browser/device.
      }
    }
  }

  const hasEME = supportedKeySystems.length > 0;
  // Spotify Web Playback SDK officially requires EME and does not reliably sustain
  // background/standalone playback on iOS Safari or installed iOS Home Screen PWAs.
  const sdkSupported = platform.isSecureContext && hasEME && !platform.isIOS;
  const sdkCaveat = platform.isIOSPWA
    ? 'iOS Home Screen PWAs cannot sustain Spotify Web Playback SDK EME/background audio. Use Spotify Connect Remote (with Spotify Premium) or Spot+ YouTube Relay.'
    : platform.isIOS
      ? 'iOS Safari restricts Spotify Web Playback SDK autoplay, EME device registration, and background audio. Use Spotify Connect Remote or Spot+ YouTube Relay.'
      : !platform.isSecureContext
        ? 'Spotify OAuth PKCE and Web Playback SDK require HTTPS.'
        : !hasEME
          ? 'This browser does not expose DRM/EME decryption required by Spotify Web Playback SDK.'
          : '';

  return {
    ...platform,
    hasEME,
    supportedKeySystems,
    sdkSupported,
    sdkCaveat,
    // Spotify Connect remote playback (controlling an active Spotify app/speaker via Web API)
    // works from any HTTPS browser with a Premium account, including iOS Safari & iOS PWA.
    connectRemoteSupported: platform.isSecureContext && platform.hasCryptoSubtle,
    // Verified policy & technical boundary: Spotify never permits server-side full-track audio proxying.
    directAudioRelaySupported: false,
    directAudioRelayReason:
      'Spotify delivers full tracks under DRM and prohibits server-side audio proxying. Spot+ uses official client-side Web Playback SDK and Spotify Connect.',
  };
}
