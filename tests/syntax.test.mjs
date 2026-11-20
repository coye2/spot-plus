import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import vm from 'node:vm';

// Every app file must parse as an ES module (module rules catch things scripts allow, like a function declared
// twice), because the browser loads them as modules and one error blanks the whole app.
test('all app scripts parse as modules', () => {
  for (const f of readdirSync(new URL('../js/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(new URL('../js/' + f, import.meta.url), 'utf8');
    assert.doesNotThrow(() => new vm.SourceTextModule(src, {identifier: f}), f);
  }
});
