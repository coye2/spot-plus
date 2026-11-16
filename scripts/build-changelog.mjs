// Writes CHANGELOG.md from js/changelog.js so GitHub and the app always match.
import {writeFile} from 'node:fs/promises';
import {CHANGELOG} from '../js/changelog.js';
const md = ['# Changelog', '', 'Every Spot+ update. The app shows the newest ones in its “What’s new” screen.', '',
  ...CHANGELOG.flatMap(e => [`## ${e.version} — ${e.title}`, `_${e.date}_`, '', ...e.items.map(i => `- ${i}`), ''])].join('\n');
await writeFile(new URL('../CHANGELOG.md', import.meta.url), md);
console.log(`Wrote CHANGELOG.md (${CHANGELOG.length} releases, latest ${CHANGELOG[0].version})`);
