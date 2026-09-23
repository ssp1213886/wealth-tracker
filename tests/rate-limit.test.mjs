import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRateLimiter } from '../src/lib/rate-limit.js';

test('rate limiter allows 60 requests and blocks the next', () => {
  let now = 1000;
  const limiter = createRateLimiter({ now: () => now });
  for (let i = 0; i < 60; i++) assert.equal(limiter.check('ip'), true);
  assert.equal(limiter.check('ip'), false);
});

test('rate limiter resets after the window', () => {
  let now = 1000;
  const limiter = createRateLimiter({ now: () => now });
  for (let i = 0; i < 60; i++) limiter.check('ip');
  now += 61000;
  assert.equal(limiter.check('ip'), true);
});

test('rate limiter tracks clients independently', () => {
  let now = 1000;
  const limiter = createRateLimiter({ now: () => now });
  for (let i = 0; i < 60; i++) limiter.check('first');
  assert.equal(limiter.check('second'), true);
  assert.equal(limiter.check('first'), false);
});
