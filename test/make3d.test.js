import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobId, resultUrl, modelUrl, falReason, FAL_QUEUE } from '../api/make3d.js';

const APP = 'fal-ai/hunyuan3d-v3';

test('a job id carries fal’s own result address there and back', () => {
  const url = `${FAL_QUEUE}${APP}/requests/0d6e7f8a-1b2c-4d5e-9f00-112233445566`;
  assert.equal(resultUrl(jobId(url), APP), url);
});

test('a bare request id still works', () => {
  assert.equal(resultUrl('0d6e7f8a-1b2c-4d5e-9f00-112233445566', APP), `${FAL_QUEUE}${APP}/requests/0d6e7f8a-1b2c-4d5e-9f00-112233445566`);
});

test('an id pointing anywhere else never gets the key', () => {
  for (const evil of ['https://evil.example/requests/x', 'https://queue.fal.run.evil.example/a/requests/x', `${FAL_QUEUE}a/../../x/requests/y`, `${FAL_QUEUE}a/requests/x?y=1`, `${FAL_QUEUE}a@b/requests/x`]) {
    const out = resultUrl(jobId(evil), APP);
    assert.ok(out.startsWith(`${FAL_QUEUE}${APP}/requests/`), evil);
  }
  assert.ok(resultUrl('../../x', APP).startsWith(`${FAL_QUEUE}${APP}/requests/`));
  assert.ok(!resultUrl('../../x', APP).includes('../'));
});

test('the model is found in each result shape', () => {
  assert.equal(modelUrl({ model_glb: { url: 'a' } }), 'a');
  assert.equal(modelUrl({ model_urls: { glb: { url: 'b' } } }), 'b');
  assert.equal(modelUrl({ model_mesh: { url: 'c' } }), 'c');
  assert.equal(modelUrl({ detail: 'nope' }), null);
  assert.equal(modelUrl(null), null);
});

test('fal’s reasons read as one short line', () => {
  assert.equal(falReason('image_too_small', 'The image is too small'), 'image_too_small: The image is too small');
  assert.equal(falReason(null, [{ msg: 'field required', type: 'missing' }, { msg: 'bad url' }]), 'field required; bad url');
  assert.equal(falReason('content_policy_violation', 'content_policy_violation detected'), 'content_policy_violation detected');
  assert.equal(falReason(null, null), '');
  assert.ok(falReason(null, 'x'.repeat(500)).length <= 240);
});

test('the service list: Hunyuan3D v3 first, Trellis 2 when it fails', async () => {
  const saved = { ...process.env };
  process.env.FAL_KEY = 'test-key'; delete process.env.MAKE3D_PROVIDER; delete process.env.MAKE3D_MODEL; delete process.env.MAKE3D_FALLBACK;
  try {
    const { provider, default: handler } = await import('../api/make3d.js');
    const p = provider();
    assert.deepEqual(p.models(), ['fal-ai/hunyuan3d-v3/image-to-3d', 'fal-ai/trellis-2']);
    assert.equal(p.model(0), 'fal-ai/hunyuan3d-v3/image-to-3d');
    assert.equal(p.model(1), 'fal-ai/trellis-2');
    assert.equal(p.model(9), 'fal-ai/trellis-2'); // past the end: the last one
    assert.deepEqual(p.input('data:x', 'fal-ai/trellis-2'), { image_url: 'data:x', resolution: 1024, texture_size: 1024, decimation_target: 120000 });
    assert.equal(p.input('data:x', p.model(0)).input_image_url, 'data:x');
    process.env.MAKE3D_FALLBACK = '';
    assert.deepEqual(p.models(), ['fal-ai/hunyuan3d-v3/image-to-3d']); // fallbacks can be turned off
    delete process.env.MAKE3D_FALLBACK;
    let body = '';
    await handler({ method: 'GET', url: '/api/make3d', headers: {} }, { writeHead() {}, end(b) { body = b; } });
    assert.deepEqual(JSON.parse(body), { available: true, provider: 'fal', tiers: 2 });
  } finally { process.env = saved; }
});
