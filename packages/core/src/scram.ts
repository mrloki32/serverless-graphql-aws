import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * Builds a PostgreSQL SCRAM-SHA-256 password verifier (RFC 5802 / 7677), i.e. the
 * value PostgreSQL itself stores in pg_authid. Passing this to
 * `ALTER ROLE ... PASSWORD '<verifier>'` sets the password without the plaintext
 * ever being sent to (or logged by) the database server.
 *
 * Generated secrets are ASCII, so SASLprep normalisation is a no-op here.
 */
export function scramSha256Verifier(password: string, iterations = 4096, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
