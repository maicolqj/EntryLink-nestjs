import { Resolver, Query, Args } from '@nestjs/graphql';

import { MyUnitService } from './my-unit.service';
import { MyUnitResponse } from './dto/my-unit.response';
import { Auth } from '../shared/decorators/auth.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../roles/enums/valid-roles';

@Resolver(() => MyUnitResponse)
export class MyUnitResolver {
  constructor(private readonly myUnitService: MyUnitService) {}

  /**
   * La unidad del residente con sus parqueaderos, bodegas, vehículos e
   * integrantes. Por rol, sin permisos nuevos: cada residente solo ve la suya.
   */
  @Query(() => MyUnitResponse, { name: 'myUnit' })
  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  myUnit(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MyUnitResponse> {
    return this.myUnitService.find(complexId, currentUser);
  }
}
