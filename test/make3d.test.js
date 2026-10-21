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
