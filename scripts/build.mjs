// Production build for GitHub Pages:
//  • every module minified (same file names, so workers and dynamic imports still resolve)
//  • all stylesheets merged in order into one minified css/app.css (one request)
//  • <link rel="modulepreload"> for the whole startup import graph (no waterfall)
//  • the service worker precaches the merged stylesheet
import {cp, mkdir, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {transform} from 'esbuild';
import './build-companion.mjs';

await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});
for (const path of ['index.html', 'audio', 'css', 'js', 'icons', 'fonts', 'sw.js', 'manifest.webmanifest']) await cp(path, `dist/${path}`, {recursive: true});

// 1. Minify modules. Userscripts keep their headers untouched; vendor files are already minified.
const skip = name => /\.user\.js$|\.meta\.js$|helper-core\.js$/.test(name);
let saved = 0;
for (const name of await readdir('js')) {
  if (!name.endsWith('.js') || skip(name)) continue;
  const source = await readFile(`js/${name}`, 'utf8');
  // shell.js is a classic script: keep its names out of the global scope.
  const {code} = await transform(source, {loader: 'js', format: name === 'shell.js' ? 'iife' : 'esm', minify: true, target: 'es2022', legalComments: 'none'});
  saved += source.length - code.length;
  await writeFile(`dist/js/${name}`, code);
}

// 2. One stylesheet, in the original cascade order.
let html = await readFile('index.html', 'utf8');
const sheets = [...html.matchAll(/<link rel="stylesheet" href="(css\/[\w-]+\.css)">\n?/g)];
const css = (await Promise.all(sheets.map(([, href]) => readFile(href, 'utf8')))).join('\n');
const {code: cssMin} = await transform(css, {loader: 'css', minify: true, target: ['safari15', 'chrome100', 'firefox100']});
await writeFile('dist/css/app.css', cssMin);
for (const [tag] of sheets) html = html.replace(tag, '');
html = html.replace('</head>', '<link rel="stylesheet" href="css/app.css">\n</head>');

// 3. Preload the static import graph of app.js.
const graph = new Set();
async function walk(file) {
  if (graph.has(file)) return;
  graph.add(file);
  const source = await readFile(file, 'utf8');
  for (const [, spec] of source.matchAll(/^\s*import\s[^'"]*?from\s*['"](\.\/[\w./-]+\.js)['"]/gm)) await walk('js/' + spec.slice(2));
}
await walk('js/app.js');
const preloads = [...graph].map(file => `<link rel="modulepreload" href="${file}">`).join('\n');
html = html.replace('</head>', `<link rel="preload" href="fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>\n${preloads}\n</head>`);
await writeFile('dist/index.html', html);

// 4. Service worker: precache the merged stylesheet too.
const sw = await readFile('dist/sw.js', 'utf8');
await writeFile('dist/sw.js', sw.replace("const SHELL = [", "const SHELL = [\n  './css/app.css',"));

console.log(`Built static app in dist/ · ${graph.size} startup modules preloaded · ${sheets.length} stylesheets merged · ${Math.round(saved / 1024)} KB saved by minifying`);
