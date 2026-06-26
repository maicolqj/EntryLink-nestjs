import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { CoefficientWeighting } from '../entities/coefficient-weighting.entity';
import { CoefficientWeightingService } from '../services/coefficient-weighting.service';
import { UpsertCoefficientWeightingInput } from '../dto/inputs/upsert-coefficient-weighting.input';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver(() => CoefficientWeighting)
export class CoefficientWeightingResolver {

  constructor(private readonly service: CoefficientWeightingService) {}

  @Query(() => CoefficientWeighting, { name: 'coefficientWeighting', nullable: true })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.VIEW_RESIDENCES],
  })
  get(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<CoefficientWeighting | null> {
    return this.service.getByComplex(complexId, currentUser);
  }

  @Mutation(() => CoefficientWeighting, { name: 'upsertCoefficientWeighting' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.EDIT_RESIDENCE],
  })
  upsert(
    @Args('input') input: UpsertCoefficientWeightingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<CoefficientWeighting> {
    return this.service.upsert(input, currentUser);
  }
}
