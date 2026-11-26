// Loaded by serverless.yml via ${file(./config/files.js):<name>} to inline
// non-YAML files (GraphQL schema, AppSync JS resolver code) into CloudFormation.
// Must stay CommonJS: Serverless Framework v3 loads it with require().
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

module.exports.schema = () => read('schema.graphql');
module.exports.lambdaResolver = () => read('resolvers/lambda-invoke.js');
