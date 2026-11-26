import { describe, expect, it } from 'vitest';
import { scramSha256Verifier } from '../src';

describe('scramSha256Verifier', () => {
  it('produces the PostgreSQL verifier format and never contains the plaintext', () => {
    const v = scramSha256Verifier('s3cret-value');
    expect(v).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(v).not.toContain('s3cret-value');
  });

  it('is deterministic for a fixed salt', () => {
    const salt = Buffer.alloc(16, 1);
    expect(scramSha256Verifier('pw', 4096, salt)).toBe(scramSha256Verifier('pw', 4096, salt));
  });
});
