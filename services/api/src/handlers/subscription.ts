import { UnauthorizedError } from '@gqlapp/core';
import { createResolver, requireUserSub } from '../lib/resolver';

process.env.SERVICE_NAME ??= 'api-subscription';

/**
 * Subscription.* resolver. AppSync runs it once, when a client subscribes
 * (not per event). It authorizes the subscription: a user may only listen to
 * their own task changes. AppSync then filters published mutation results by
 * the `owner` argument.
 */
export const handler = createResolver({
  onTaskChanged: async (event) => {
    const sub = requireUserSub(event);
    if (event.arguments?.owner !== sub) {
      throw new UnauthorizedError('You can only subscribe to your own task changes');
    }
    return null;
  },
});
