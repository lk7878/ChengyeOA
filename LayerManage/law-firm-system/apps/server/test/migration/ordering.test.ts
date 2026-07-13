import assert from 'node:assert/strict';
import test from 'node:test';
import { compareUnicodeCodePoints } from '../../scripts/migration/ordering';

test('sorts strings by fixed Unicode code-point order', () => {
  const privateUseBmp = '\uE000';
  const astralEmoji = '\u{1F600}';

  assert.deepEqual(
    [astralEmoji, privateUseBmp].sort(compareUnicodeCodePoints),
    [privateUseBmp, astralEmoji],
  );
});
