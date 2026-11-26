// AppSync JS (APPSYNC_JS 1.0.0) unit resolver shared by every field.
//
// Request:  forwards only what the Lambda needs (field, args, caller identity).
// Response: the Lambda returns { data } on success or { error: { message, type } }
//           for expected failures (validation, not found, unauthorized). Expected
//           failures therefore do NOT count as Lambda `Errors`, so the error alarms
//           (which also drive CodeDeploy canary rollback) only fire on real faults.
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Invoke',
    payload: {
      parentTypeName: ctx.info.parentTypeName,
      fieldName: ctx.info.fieldName,
      arguments: ctx.arguments,
      identity: ctx.identity,
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  if (ctx.result && ctx.result.error) {
    util.error(ctx.result.error.message, ctx.result.error.type);
  }
  return ctx.result ? ctx.result.data : null;
}
