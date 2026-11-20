import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSpotify, routeFor, isShortLink} from '../js/spotify-open.js';

test('Spotify links of every kind open the right Spot+ page', () => {
  assert.deepEqual(parseSpotify('check this https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b?si=abc'), {kind: 'track', id: '0VjIjW4GlUZAMYd2vXMi3b'});
  assert.equal(routeFor(parseSpotify('https://open.spotify.com/intl-de/album/4m2880jivSbbyEGAKfITCa')), '#/spalbum/4m2880jivSbbyEGAKfITCa');
  assert.equal(routeFor(parseSpotify('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')), '#/linked/37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(routeFor(parseSpotify('https://open.spotify.com/artist/1Xyo4u8uXC1ZmMpatF05PJ')), '#/sartist/1Xyo4u8uXC1ZmMpatF05PJ');
  assert.equal(parseSpotify('https://open.spotify.com/track/short'), null);
  assert.equal(parseSpotify('just some words'), null);
  assert.equal(isShortLink('https://spotify.link/AbCdE'), true);
});
