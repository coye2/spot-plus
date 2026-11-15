import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const file of [...(await readdir('js')).filter(f=>f.endsWith('.js')).map(f=>`js/${f}`),'sw.js','canvas-bridge/worker.js','canvas-bridge/spotify-stats.js']) {
  const result = spawnSync(process.execPath, ['--check',file], {stdio:'inherit'});
  if (result.status) process.exit(result.status);
}
console.log('All JavaScript modules passed syntax checks. No TypeScript in this project.');
