function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

/**
 * All values are non-secret references (hostnames, ARNs) injected by serverless.yml
 * from CloudFormation outputs. Secret values are fetched at runtime from
 * Secrets Manager using the function's IAM role.
 */
export const config = {
  get dbReadHost() {
    return process.env.DB_READ_HOST || required('DB_HOST');
  },
  get dbPort() {
    return Number(process.env.DB_PORT ?? 5432);
  },
  get dbName() {
    return required('DB_NAME');
  },
  get dbSsl() {
    return (process.env.DB_SSL ?? 'true') === 'true';
  },
  get readOnlySecretArn() {
    return required('DB_RO_SECRET_ARN');
  },
  get internalApiUrl() {
    return required('INTERNAL_API_URL');
  },
  get internalTokenSecretArn() {
    return required('INTERNAL_API_TOKEN_SECRET_ARN');
  },
  get version() {
    return process.env.GIT_SHA ?? 'unknown';
  },
};
