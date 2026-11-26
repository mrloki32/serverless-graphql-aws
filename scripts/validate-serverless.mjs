#!/usr/bin/env node
/**
 * Offline validation of the Serverless (AppSync + Lambda) stack, no AWS account needed:
 *   1. render services/api/serverless.yml with placeholder values for the
 *      ${cf:...} stack outputs and ${aws:accountId}
 *   2. `serverless package` for each stage (bundles the Lambdas with esbuild and
 *      runs the canary-deployments plugin, i.e. the real CloudFormation template)
 *   3. cfn-lint the generated template
 *
 * Usage: node scripts/validate-serverless.mjs [stage ...]   (default: staging prod)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'services', 'api');
const stages = process.argv.slice(2).length ? process.argv.slice(2) : ['staging', 'prod'];

const ACCOUNT = '111111111111';
function placeholder(output) {
  if (/Subnet\d*Id$/.test(output)) return 'subnet-0123456789abcdef0';
  if (/SecurityGroupId$/.test(output)) return 'sg-0123456789abcdef0';
  if (/Topic/.test(output)) return `arn:aws:sns:us-east-1:${ACCOUNT}:placeholder-alarms`;
  if (/RoleArn$/.test(output)) return `arn:aws:iam::${ACCOUNT}:role/gqlapp-placeholder`;
  if (/SecretArn$/.test(output)) return `arn:aws:secretsmanager:us-east-1:${ACCOUNT}:secret:gqlapp/placeholder-AbCdEf`;
  if (/BucketName$/.test(output)) return 'gqlapp-deployments-placeholder';
  if (output === 'SiteUrl') return 'https://d111111abcdef8.cloudfront.net';
  if (output === 'InternalApiUrl') return 'http://internal-gqlapp-placeholder.us-east-1.elb.amazonaws.com';
  if (/Endpoint$/.test(output)) return 'gqlapp-placeholder.abcdefghijkl.us-east-1.rds.amazonaws.com';
  if (output === 'Port') return '5432';
  if (output === 'DatabaseName') return 'appdb';
  throw new Error(`No placeholder for stack output "${output}" - add one to validate-serverless.mjs`);
}

const source = readFileSync(path.join(apiDir, 'serverless.yml'), 'utf8');
const rendered = source
  .replace(/\$\{cf:\$\{self:custom\.stacks\.\w+\}\.(\w+)\}/g, (_, out) => placeholder(out))
  .replace(/\$\{cf:[\w-]+\.(\w+)\}/g, (_, out) => placeholder(out))
  .replaceAll('${aws:accountId}', ACCOUNT);
if (/\$\{(cf|aws):/.test(rendered)) throw new Error('Unresolved ${cf:} / ${aws:} variable left in the rendered config');

const tmpConfig = 'serverless.validate.yml';
writeFileSync(path.join(apiDir, tmpConfig), rendered);

const cfnLint = process.env.CFN_LINT ?? 'cfn-lint';
let failed = false;
try {
  for (const stage of stages) {
    console.log(`\n▶ serverless package --stage ${stage}`);
    execFileSync('npx', ['serverless', 'package', '--config', tmpConfig, '--stage', stage, '--region', 'us-east-1'], {
      cwd: apiDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, SLS_TELEMETRY_DISABLED: '1', SLS_NOTIFICATIONS_MODE: 'off' },
    });
    const template = path.join(apiDir, '.serverless', 'cloudformation-template-update-stack.json');
    console.log(`▶ cfn-lint (${stage})`);
    try {
      // W3005: the Serverless Framework itself adds a redundant DependsOn on custom
      // function roles (MigrateRole); not something this template controls.
      execFileSync(cfnLint, ['--ignore-checks', 'W3005', '--', template], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      console.log(`✓ ${stage}: template is valid`);
    } catch {
      failed = true;
      console.error(`✗ ${stage}: cfn-lint reported problems`);
    }
  }
} finally {
  rmSync(path.join(apiDir, tmpConfig), { force: true });
}
process.exit(failed ? 1 : 0);
