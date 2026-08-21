import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

async function text(path) { return readFile(new URL(path, ROOT), 'utf8'); }

test('browser entrypoint uses canonical Wulan runtime', async () => {
  const html = await text('index.html');
  assert.match(html, /src=["']wulan-os\.js["']/);
  assert.match(html, /src=["']wulan\/world-runtime-v2\.js["']/);
  assert.doesNotMatch(html, /nova2-shell\.js|wulan2-shell\.js|wulan-living\.js/);
});

test('canonical browser runtime does not import legacy shell runtimes', async () => {
  const runtime = await text('wulan-os.js');
  assert.doesNotMatch(runtime, /nova2-shell|wulan2-shell|wulan-living/);
});
