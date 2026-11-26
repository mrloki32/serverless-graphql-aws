/**
 * Runtime configuration, fetched from /config.json (written per stage at deploy
 * time from CloudFormation outputs). One build artifact is promoted unchanged
 * from staging to production. Contains only public identifiers - no secrets.
 */
export interface AppConfig {
  stage: string;
  region: string;
  graphqlUrl: string;
  realtimeUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  cognitoDomain: string;
  version: string;
}

const KEYS: Array<keyof AppConfig> = [
  'stage',
  'region',
  'graphqlUrl',
  'realtimeUrl',
  'userPoolId',
  'userPoolClientId',
  'cognitoDomain',
  'version',
];

export function parseConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') throw new Error('config.json is not an object');
  const obj = raw as Record<string, unknown>;
  const missing = KEYS.filter((k) => typeof obj[k] !== 'string' || obj[k] === '');
  if (missing.length) throw new Error(`config.json is missing: ${missing.join(', ')}`);
  const cfg = obj as unknown as AppConfig;
  if (!cfg.graphqlUrl.startsWith('https://')) throw new Error('graphqlUrl must use https');
  if (!cfg.realtimeUrl.startsWith('wss://')) throw new Error('realtimeUrl must use wss');
  return cfg;
}

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load /config.json (HTTP ${res.status})`);
  return parseConfig(await res.json());
}
