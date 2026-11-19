import { Args, Query, Resolver } from '@nestjs/graphql';
import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { GROWTH_ROLE_NAMES } from '../../shared/growth-access.catalog';
import { ActivityEvent } from '../entities/activity-event.entity';
import { GrowthActivityFilterInput } from '../dto/inputs/growth-activity-filter.input';
import { PaginatedGrowthActivityResponse } from '../dto/responses/paginated-growth-activity.response';
import { ActivityLogService } from '../services/activity-log.service';

/** Solo lectura: el registro de actividad no tiene mutaciones. */
@Resolver(() => ActivityEvent)
export class GrowthActivityResolver {
  constructor(private readonly activity: ActivityLogService) {}

  // Cualquier rol de la suite ve su propia actividad; ver la de todos exige
  // VIEW_GROWTH_ACTIVITY (lo decide el servicio). Estrategia OR del @Auth.
  @Auth({
    roles: GROWTH_ROLE_NAMES,
    permissions: [ValidPermissions.VIEW_GROWTH_ACTIVITY],
  })
  @Query(() => PaginatedGrowthActivityResponse, {
    name: 'growthActivity',
    description:
      'Actividad de la Growth Suite, de la más reciente a la más antigua. ' +
      'Sin VIEW_GROWTH_ACTIVITY solo devuelve la del propio usuario.',
  })
  growthActivity(
    @CurrentUser() actor: JwtAccessPayload,
    @Args('filter', { nullable: true }) filter?: GrowthActivityFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedGrowthActivityResponse> {
    return this.activity.list(
      actor,
      filter ?? {},
      pagination ?? { page: 1, limit: 25 },
    );
  }
}
