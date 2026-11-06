// Size report for the GitHub Pages build. Fails (exit 1) when the initial
// download exceeds its budget or a Pages hard limit is broken.
//
//   node tools/pages/size-report.mjs [distDir]
//
// Budgets (KiB, override with env): BUDGET_INITIAL_CODE_KB covers the gzip
// size of index.html + entry script + modulepreloads + stylesheets;
// BUDGET_INITIAL_TOTAL_KB adds the assets index.html preloads.
import { appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { revision } from './vite-plugin.mjs';

const DIST = resolve(process.argv[2] ?? 'dist');
const KB = 1024;
const MB = KB * KB;
const BUDGET_INITIAL_CODE = Number(process.env.BUDGET_INITIAL_CODE_KB ?? 400) * KB;
const BUDGET_INITIAL_TOTAL = Number(process.env.BUDGET_INITIAL_TOTAL_KB ?? 2560) * KB;
const PAGES_FILE_LIMIT = 100 * MB;
const PAGES_FILE_WARN = 50 * MB;
const PAGES_SITE_LIMIT = 1024 * MB;
// Pages gzips text responses; binary media is sent as stored.
const GZIPPED = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.wasm', '.map']);

const fmt = (bytes) => (bytes >= MB ? `${(bytes / MB).toFixed(2)} MB` : `${(bytes / KB).toFixed(1)} KB`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(DIST).map((path) => {
  const rel = relative(DIST, path).split(sep).join('/');
  const bytes = readFileSync(path);
  const wire = GZIPPED.has(extname(rel)) ? gzipSync(bytes).length : bytes.length;
  const lfs = bytes.subarray(0, 64).toString('latin1').startsWith('version https://git-lfs.github.com/spec/');
  return { rel, size: bytes.length, wire, lfs };
});
const byPath = new Map(files.map((file) => [file.rel, file]));

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const base = (html.match(/<script type="module"[^>]*src="([^"]+)assets\//)?.[1]) ?? '/';
const local = (href) => href.startsWith(base) ? href.slice(base.length) : href.replace(/^\.?\//, '');
const refs = (pattern) => [...html.matchAll(pattern)].map((match) => local(match[1]));
const code = [
  'index.html',
  ...refs(/<script type="module"[^>]*\ssrc="([^"]+)"/g),
  ...refs(/<link rel="modulepreload"[^>]*\shref="([^"]+)"/g),
  ...refs(/<link rel="stylesheet"[^>]*\shref="([^"]+)"/g),
];
const preloads = refs(/<link rel="preload"[^>]*\shref="([^"]+)"/g);

const problems = [];
const warnings = [];
const sum = (list, key) => list.reduce((total, rel) => {
  const file = byPath.get(rel);
  if (!file) problems.push(`index.html references a missing file: ${rel}`);
  return total + (file?.[key] ?? 0);
}, 0);
const initialCode = sum(code, 'wire');
const initialTotal = initialCode + sum(preloads, 'wire');
const site = files.reduce((total, file) => total + file.size, 0);

if (initialCode > BUDGET_INITIAL_CODE) {
  problems.push(`initial code ${fmt(initialCode)} (gzip) exceeds the ${fmt(BUDGET_INITIAL_CODE)} budget: lazy-load the new dependency with import()`);
}
if (initialTotal > BUDGET_INITIAL_TOTAL) {
  problems.push(`initial download ${fmt(initialTotal)} exceeds the ${fmt(BUDGET_INITIAL_TOTAL)} budget`);
}
if (site > PAGES_SITE_LIMIT) problems.push(`site is ${fmt(site)}; GitHub Pages sites must stay under 1 GB`);
for (const file of files) {
  if (file.size > PAGES_FILE_LIMIT) problems.push(`${file.rel} is ${fmt(file.size)}; Pages rejects files over 100 MB`);
  else if (file.size > PAGES_FILE_WARN) warnings.push(`${file.rel} is ${fmt(file.size)}; GitHub warns above 50 MB`);
  if (file.lfs) problems.push(`${file.rel} is a Git LFS pointer; Pages does not serve LFS content`);
}

// The service worker caches a fixed-name file only when its bytes match the
// revision recorded at build time. A file rewritten afterwards (e.g. a
// post-build step on dist/models) would download on every visit instead.
const swSource = byPath.has('sw.js') ? readFileSync(join(DIST, 'sw.js'), 'utf8') : '';
const swManifest = JSON.parse(swSource.match(/^self\.__VIBE_MANIFEST__ = (.*);$/m)?.[1] ?? 'null');
if (swManifest) {
  const known = new Set([...swManifest.shell, ...swManifest.immutable, ...Object.keys(swManifest.files), 'sw.js', '404.html', '.nojekyll']);
  for (const [rel, expected] of Object.entries(swManifest.files)) {
    if (byPath.has(rel) && revision(readFileSync(join(DIST, rel))) !== expected) {
      problems.push(`${rel} changed after the service worker manifest was built: run asset steps as a pagesDeploy preprocess step, not after the build`);
    }
  }
  for (const file of files) {
    if (!known.has(file.rel)) problems.push(`${file.rel} is not in the service worker manifest (written after the build?)`);
  }
} else {
  problems.push('dist/sw.js or its manifest is missing');
}

const groups = new Map();
for (const file of files) {
  const top = file.rel.includes('/') ? file.rel.split('/')[0] : '(root)';
  const group = groups.get(top) ?? { count: 0, size: 0, wire: 0 };
  group.count += 1;
  group.size += file.size;
  group.wire += file.wire;
  groups.set(top, group);
}
const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 5);

const lines = [
  '## GitHub Pages size report',
  '',
  `Base: \`${base}\``,
  '',
  '| Initial load | Transfer | Budget |',
  '| --- | ---: | ---: |',
  ...code.map((rel) => `| \`${rel}\` | ${fmt(byPath.get(rel)?.wire ?? 0)} | |`),
  `| **Code subtotal (gzip)** | **${fmt(initialCode)}** | ${fmt(BUDGET_INITIAL_CODE)} |`,
  ...preloads.map((rel) => `| \`${rel}\` (preload) | ${fmt(byPath.get(rel)?.wire ?? 0)} | |`),
  `| **Initial total** | **${fmt(initialTotal)}** | ${fmt(BUDGET_INITIAL_TOTAL)} |`,
  '',
  '| Folder | Files | Size | Transfer |',
  '| --- | ---: | ---: | ---: |',
  ...[...groups].sort((a, b) => b[1].size - a[1].size)
    .map(([name, group]) => `| ${name} | ${group.count} | ${fmt(group.size)} | ${fmt(group.wire)} |`),
  `| **Site** | **${files.length}** | **${fmt(site)}** | |`,
  '',
  `Largest files: ${largest.map((file) => `\`${file.rel}\` ${fmt(file.size)}`).join(', ')}`,
  '',
  ...warnings.map((warning) => `> Warning: ${warning}`),
  ...problems.map((problem) => `> **Fail:** ${problem}`),
  problems.length ? '' : 'All Pages limits and budgets pass.',
];
const report = `${lines.join('\n')}\n`;
process.stdout.write(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (problems.length) process.exit(1);
