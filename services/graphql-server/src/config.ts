export interface ServerConfig {
  port: number;
  production: boolean;
  internalToken: string;
  db: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

/**
 * DB_USERNAME / DB_PASSWORD / INTERNAL_API_TOKEN are injected by the ECS agent
 * from AWS Secrets Manager (task definition `Secrets`), never baked into the image.
 */
export function loadConfig(env = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 4000),
    production: env.NODE_ENV === 'production',
    internalToken: required('INTERNAL_API_TOKEN'),
    db: {
      host: required('DB_HOST'),
      port: Number(env.DB_PORT ?? 5432),
      database: required('DB_NAME'),
      user: required('DB_USERNAME'),
      password: required('DB_PASSWORD'),
      ssl: (env.DB_SSL ?? 'true') === 'true',
    },
  };
}
