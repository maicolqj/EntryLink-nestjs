import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtAccessPayload } from '../interfaces/jwt-payload.interface';

function resolveUser(ctx: ExecutionContext): JwtAccessPayload | undefined {
  const gqlCtx = GqlExecutionContext.create(ctx).getContext();
  // HTTP queries/mutations
  const httpUser = (gqlCtx.req ?? gqlCtx.request)?.user;
  if (httpUser) return httpUser;
  // WebSocket subscriptions (graphql-ws): user attached in onConnect
  return gqlCtx.user ?? undefined;
}

export const CurrentUser = createParamDecorator((data: keyof JwtAccessPayload | undefined, ctx: ExecutionContext) => {
  const user = resolveUser(ctx);
  if (!user) throw new UnauthorizedException('No autenticado');
  return data ? user[data] : user;
});

export const CurrentUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const user = resolveUser(ctx);
  if (!user?.sub) throw new UnauthorizedException('No autenticado');
  return user.sub;
});

export const CurrentSessionId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const user = resolveUser(ctx);
  if (!user?.sessionId) throw new UnauthorizedException('No autenticado');
  return user.sessionId;
});