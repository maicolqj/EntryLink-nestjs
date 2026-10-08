import { Resolver, Mutation, Query, Args } from '@nestjs/graphql';

import { SecurityAppExitsService } from '../services/security-app-exits.service';
import { SecurityAppExit } from '../entities/security-app-exit.entity';
import { ReportAppStateInput } from '../dto/inputs/report-app-state.input';
import { FilterSecurityAppExitsInput } from '../dto/inputs/filter-security-app-exits.input';
import { PaginatedSecurityAppExitsResponse } from '../dto/responses/paginated-security-app-exits.response';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Auth } from '../../shared/decorators/auth.decorator';
import { ValidRoles } from '../../roles/enums/valid-roles';

@Resolver(() => SecurityAppExit)
export class SecurityAppExitsResolver {
  constructor(private readonly exitsService: SecurityAppExitsService) {}

  // ════════════════════════════════════════════════════════════════
  // VIGILANTE (EntryLink)
  // ════════════════════════════════════════════════════════════════

  @Auth({ roles: [ValidRoles.SECURITY_ROL] })
  @Mutation(() => SecurityAppExit, {
    name: 'reportAppBackground',
    description:
      'EntryLink pasó a segundo plano. Abre la salida del vigilante; si ya hay ' +
      'una abierta la devuelve sin duplicarla.',
  })
  reportAppBackground(
    @CurrentUser() currentUser: JwtAccessPayload,
    @Args('input', { nullable: true }) input?: ReportAppStateInput,
  ): Promise<SecurityAppExit> {
    return this.exitsService.reportBackground(input ?? {}, currentUser);
  }

  @Auth({ roles: [ValidRoles.SECURITY_ROL] })
  @Mutation(() => SecurityAppExit, {
    name: 'reportAppForeground',
    nullable: true,
    description:
      'EntryLink volvió a primer plano (o arrancó). Cierra la salida abierta del ' +
      'vigilante; null si no había ninguna.',
  })
  reportAppForeground(
    @CurrentUser() currentUser: JwtAccessPayload,
    @Args('input', { nullable: true }) input?: ReportAppStateInput,
  ): Promise<SecurityAppExit | null> {
    return this.exitsService.reportForeground(input ?? {}, currentUser);
  }

  // ════════════════════════════════════════════════════════════════
  // ADMINISTRACIÓN
  // ════════════════════════════════════════════════════════════════

  @Auth({
    roles: [
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
  })
  @Query(() => PaginatedSecurityAppExitsResponse, {
    name: 'securityAppExits',
    description:
      'Salidas de los vigilantes de la app de portería, de la más reciente a la ' +
      'más antigua. Las que no tienen returnedAt siguen abiertas.',
  })
  securityAppExits(
    @Args('complexId', { type: () => String }) complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
    @Args('filters', { nullable: true }) filters?: FilterSecurityAppExitsInput,
  ): Promise<PaginatedSecurityAppExitsResponse> {
    return this.exitsService.findByComplex(
      complexId,
      pagination ?? { page: 1, limit: 10 },
      filters,
      currentUser,
    );
  }
}
