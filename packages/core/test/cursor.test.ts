import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, ValidationError } from '../src';

describe('cursor', () => {
  it('round-trips', () => {
    const c = { createdAt: '2026-01-02T03:04:05.678Z', id: '2f1c1a8e-4c1b-4a43-9d8a-0b6f6f0f5d11' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it.each(['', 'not-base64!', Buffer.from('{"a":1}').toString('base64url'), encodeCursor({ createdAt: 'nope', id: 'x' })])(
    'rejects tampered token %s',
    (token) => {
      expect(() => decodeCursor(token)).toThrow(ValidationError);
    },
  );
});
