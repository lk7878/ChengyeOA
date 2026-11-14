import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostEnvironment, isTrustedBridgeCall, navigation, validateOaUrl } from '../config.mjs';

test('OA bridge rejects other windows, child frames, navigated frames and destroyed frames', () => {
  const frame = { url: 'https://oa.example/cases' }, contents = { mainFrame: frame };
  assert.equal(isTrustedBridgeCall({ sender: contents, senderFrame: frame }, contents, 'https://oa.example'), true);
  for (const event of [{ sender: {}, senderFrame: frame }, { sender: contents, senderFrame: { ...frame } }, { sender: contents, senderFrame: null }]) {
    assert.equal(isTrustedBridgeCall(event, contents, 'https://oa.example'), false);
  }
  frame.url = 'https://oa.example.attacker.test';
  assert.equal(isTrustedBridgeCall({ sender: contents, senderFrame: frame }, contents, 'https://oa.example'), false);
});

test('remote configuration and navigation cannot introduce local files, scripts or embedded credentials', () => {
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'http://public.example', 'https://a:b@oa.example', 'https://oa.example/?token=x']) assert.throws(() => validateOaUrl(url));
  assert.equal(validateOaUrl('https://oa.example/'), 'https://oa.example/');
  assert.equal(validateOaUrl('http://localhost:3000/'), 'http://localhost:3000/');
  assert.equal(navigation('https://oa.example/cases', 'https://oa.example'), 'allow');
  assert.equal(navigation('https://external.example', 'https://oa.example'), 'external');
  for (const url of ['file:///C:/secret', 'javascript:1', 'chengye://run', 'https://a:b@oa.example']) assert.equal(navigation(url, 'https://oa.example'), 'deny');
});

test('local host excludes cloud secrets and disables session telemetry', () => {
  const saved = process.env.CHENGYE_MODEL_API_KEY;
  process.env.CHENGYE_MODEL_API_KEY = 'test-only';
  try {
    const env = hostEnvironment('C:/test-home');
    assert.equal(env.CHENGYE_MODEL_API_KEY, undefined);
    assert.equal(env.DSH_TELEMETRY_DISABLED, '1');
    assert.equal(env.DSH_TELEMETRY_MODE, 'DISABLED');
  } finally { if (saved === undefined) delete process.env.CHENGYE_MODEL_API_KEY; else process.env.CHENGYE_MODEL_API_KEY = saved; }
});
