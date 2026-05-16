import { Resolver, Query } from '@nestjs/graphql';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../shared/decorators/public.decorator';

@SkipThrottle()
@Resolver()
export class HealthResolver {

  @Public()
  @Query(() => String, {
    name: 'ping',
    description: 'Verifica conectividad con el backend. Siempre retorna "pong".',
  })
  ping(): string {
    return 'pong';
  }
}
