import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

async function jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await jsFiles(full)));
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [
  ...(await jsFiles('js')),
  ...(await jsFiles('workers/spotify-relay/src')),
  'sw.js',
  'canvas-bridge/worker.js',
  'canvas-bridge/access.js',
  'canvas-bridge/referral.js',
  'canvas-bridge/spotify-stats.js',
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
console.log(`All ${files.length} JavaScript modules passed syntax checks. No TypeScript in this project.`);
