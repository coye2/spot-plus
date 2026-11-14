import { cp, mkdir } from 'node:fs/promises';
import './build-companion.mjs';
await mkdir('dist', { recursive:true });
for (const path of ['index.html','audio','css','js','icons','fonts','sw.js','manifest.webmanifest']) await cp(path, `dist/${path}`, {recursive:true});
console.log('Built static app in dist/');
