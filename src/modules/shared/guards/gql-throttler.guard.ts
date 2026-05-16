import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlCtx = GqlExecutionContext.create(context);
    const ctx    = gqlCtx.getContext<{ user?: any }>();

    // WS subscriptions: context has `user` (set by onConnect) but no proper HTTP res.
    // Connections are already gated by JWT — skip throttling entirely.
    if (ctx?.user) return true;

    return super.canActivate(context);
  }

  protected getRequestResponse(context: ExecutionContext) {
    const gqlCtx = GqlExecutionContext.create(context);
    const ctx    = gqlCtx.getContext<{ req?: any; res?: any }>();

    if (ctx?.req) {
      const res = ctx.res ?? ctx.req?.res ?? { header: () => {} };
      return { req: ctx.req, res };
    }

    const http = context.switchToHttp();
    return { req: http.getRequest(), res: http.getResponse() };
  }
}
