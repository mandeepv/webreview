import { describe, expect, it } from 'vitest';
import { VARIANTS, variantKeyFor } from './variants';

describe('variantKeyFor (B-7)', () => {
  it('returns each real variant', () => {
    for (const key of Object.keys(VARIANTS)) expect(variantKeyFor(key)).toBe(key);
  });

  it('falls back to default for anything else, including Object.prototype’s own names', () => {
    for (const a of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'nope', '', undefined, ['tantrums'], 42]) {
      expect(variantKeyFor(a), String(a)).toBe('default');
    }
  });

  it('every variant has the copy the landing renders', () => {
    for (const [key, v] of Object.entries(VARIANTS)) {
      expect(typeof v.headline, key).toBe('string');
      expect(typeof v.sub, key).toBe('string');
    }
  });
});
