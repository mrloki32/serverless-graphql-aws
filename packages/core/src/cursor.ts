import { ValidationError } from './errors';

export interface Cursor {
  createdAt: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque keyset-pagination token: base64url([createdAt, id]). */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString('base64url');
}

export function decodeCursor(token: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      UUID_RE.test(parsed[1])
    ) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  throw new ValidationError('nextToken is invalid');
}
