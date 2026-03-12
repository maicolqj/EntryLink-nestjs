import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtAccessPayload } from '../interfaces/jwt-payload.interface';

export const CurrentUser = createParamDecorator((data: keyof JwtAccessPayload | undefined, ctx: ExecutionContext) => {
  const gqlCtx = GqlExecutionContext.create(ctx);
  const user: JwtAccessPayload = (gqlCtx.getContext().req || gqlCtx.getContext().request)?.user;
  if (!user) throw new UnauthorizedException('No autenticado');
  return data ? user[data] : user;
});

export const CurrentUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const gqlCtx = GqlExecutionContext.create(ctx);
  const user = (gqlCtx.getContext().req || gqlCtx.getContext().request)?.user;
  if (!user?.sub) throw new UnauthorizedException('No autenticado');
  return user.sub;
});

export const CurrentSessionId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const gqlCtx = GqlExecutionContext.create(ctx);
  const user = (gqlCtx.getContext().req || gqlCtx.getContext().request)?.user;
  if (!user?.sessionId) throw new UnauthorizedException('No autenticado');
  return user.sessionId;
});