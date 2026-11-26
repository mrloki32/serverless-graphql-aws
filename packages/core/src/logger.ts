type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /pass(word)?|secret|token|authorization|cookie/i;

function minLevel(): Level {
  const l = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (l in ORDER ? l : 'info') as Level;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      REDACT.test(k) ? '[REDACTED]' : redact(v, depth + 1),
    ]),
  );
}

function log(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[minLevel()]) return;
  // One JSON object per line -> CloudWatch Logs Insights can query fields directly.
  const line = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    service: process.env.SERVICE_NAME,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => log('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => log('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => log('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => log('error', m, f),
};
