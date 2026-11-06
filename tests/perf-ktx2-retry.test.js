import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithRetries, KTX2_RETRIES } from '../src/perf/textureCompression.js';

function flaky(failures, error = new Error('transcode failed')) {
  let calls = 0;
  const attempt = (onLoad, onError) => {
    calls += 1;
    setTimeout(() => (calls <= failures ? onError(error) : onLoad(`texture#${calls}`)), 0);
  };
  return { attempt, calls: () => calls };
}

test('a transient KTX2 failure is retried and the texture still loads', async () => {
  const source = flaky(KTX2_RETRIES);
  const seen = [];
  const texture = await loadWithRetries(source.attempt, { delayMs: 1, onRetry: (error, n) => seen.push([error.message, n]) });
  assert.equal(texture, `texture#${KTX2_RETRIES + 1}`);
  assert.deepEqual(seen.map(([, n]) => n), Array.from({ length: KTX2_RETRIES }, (_, i) => i + 1));
});

test('a persistent failure rejects with the real reason after the retry budget', async () => {
  const source = flaky(Infinity, new Error('Invalid or unsupported .ktx2 file'));
  await assert.rejects(loadWithRetries(source.attempt, { delayMs: 1 }), /Invalid or unsupported/);
  assert.equal(source.calls(), KTX2_RETRIES + 1);
});

test('a failed transcoder initialisation is cleared before the next attempt', async () => {
  let transcoderReady = false;
  const attempt = (onLoad, onError) => setTimeout(() => (transcoderReady ? onLoad('ok') : onError(new Error('transcoder fetch failed'))), 0);
  const texture = await loadWithRetries(attempt, { delayMs: 1, beforeRetry: async () => { transcoderReady = true; } });
  assert.equal(texture, 'ok');
});
