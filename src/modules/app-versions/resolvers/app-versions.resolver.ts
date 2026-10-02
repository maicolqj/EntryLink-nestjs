import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Auth } from '../../shared/decorators/auth.decorator';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { AppVersionsService } from '../services/app-versions.service';
import { AppVersionPolicy } from '../entities/app-version-policy.entity';
import { ClientApp, ClientPlatform } from '../enums/client-app.enum';
import {
  AppVersionCheck,
  SetAppVersionPolicyInput,
} from '../dto/app-version.dto';

@Resolver()
export class AppVersionsResolver {
  constructor(private readonly service: AppVersionsService) {}

  /**
   * Pública: la app la consulta al abrir, también antes de iniciar sesión.
   * Una versión vieja tiene que poder enterarse de que debe actualizar aunque
   * ya no pueda entrar.
   */
  @Public()
  @Query(() => AppVersionCheck, {
    name: 'appVersionCheck',
    description:
      '¿La versión instalada debe actualizarse obligatoriamente? (cambios que rompen compatibilidad)',
  })
  appVersionCheck(
    @Args('app', { type: () => ClientApp }) app: ClientApp,
    @Args('platform', { type: () => ClientPlatform }) platform: ClientPlatform,
    @Args('versionCode', { type: () => Int }) versionCode: number,
  ): Promise<AppVersionCheck> {
    return this.service.check(app, platform, versionCode);
  }

  @Query(() => [AppVersionPolicy], {
    name: 'appVersionPolicies',
    description: 'Versión mínima obligatoria de cada app y plataforma',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  appVersionPolicies(): Promise<AppVersionPolicy[]> {
    return this.service.list();
  }

  @Mutation(() => AppVersionPolicy, {
    name: 'setAppVersionPolicy',
    description:
      'Fija la versión mínima: las instalaciones anteriores quedan bloqueadas hasta actualizar.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  setAppVersionPolicy(
    @Args('input') input: SetAppVersionPolicyInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<AppVersionPolicy> {
    return this.service.set(input, user.sub);
  }
}
