import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard extendido que funciona tanto en contextos HTTP (REST)
 * como en contextos GraphQL.
 *
 * El guard por defecto usa switchToHttp().getRequest() que retorna undefined
 * para resolvers GraphQL, causando "Cannot read properties of undefined (reading 'ip')".
 */
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected getRequestResponse(context: ExecutionContext) {
    // Intentar extraer del contexto GraphQL primero
    const gqlCtx = GqlExecutionContext.create(context);
    const ctx    = gqlCtx.getContext<{ req?: any; res?: any }>();

    if (ctx?.req) {
      return { req: ctx.req, res: ctx.res ?? ctx.req.res ?? {} };
    }

    // Fallback para endpoints REST
    const http = context.switchToHttp();
    return { req: http.getRequest(), res: http.getResponse() };
  }
}
