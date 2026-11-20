import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSuggestions} from '../js/search-suggest.js';

test('autocomplete: recent searches, then artists who start with it, then songs; Spotify links get their own row', () => {
  const s = buildSuggestions({q: 'just', recents: ['justin bieber peaches', 'drake'], artists: [{id: 1, name: 'Justin Bieber', fans: 9e6}, {id: 2, name: 'Justice', fans: 2e6}, {id: 3, name: 'Drake'}],
    songs: [{title: 'Just the Way You Are', artist: 'Bruno Mars', cover: 'x'}]});
  assert.deepEqual(s.map((x) => x.kind), ['recent', 'artist', 'artist', 'song', 'search']);
  assert.equal(s[1].text, 'Justin Bieber');
  assert.equal(s[1].href, '#/artist/1');
  assert.deepEqual(buildSuggestions({q: '', recents: ['a', 'b']}).map((x) => x.text), ['a', 'b'], 'empty box shows recent searches');
  assert.equal(buildSuggestions({q: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b'})[0].kind, 'spotify');
});
