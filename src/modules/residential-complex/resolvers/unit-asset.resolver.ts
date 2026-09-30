import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { UnitAsset } from '../entities/unit-asset.entity';
import { UnitAssetService } from '../services/unit-asset.service';
import {
  CreateUnitAssetInput,
  UpdateUnitAssetInput,
} from '../dto/inputs/unit-asset.input';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

/**
 * Parqueaderos y bodegas propios de cada unidad. Se administran con el mismo
 * permiso con que se edita la unidad; el residente los ve por `myUnit`.
 */
@Resolver(() => UnitAsset)
export class UnitAssetResolver {
  constructor(private readonly assetService: UnitAssetService) {}

  @Query(() => [UnitAsset], { name: 'unitAssets' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.VIEW_RESIDENCES],
  })
  unitAssets(
    @Args('unitId') unitId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<UnitAsset[]> {
    return this.assetService.findByUnit(unitId, currentUser);
  }

  @Mutation(() => UnitAsset, { name: 'createUnitAsset' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.EDIT_RESIDENCE],
  })
  create(
    @Args('input') input: CreateUnitAssetInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<UnitAsset> {
    return this.assetService.create(input, currentUser);
  }

  @Mutation(() => UnitAsset, { name: 'updateUnitAsset' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.EDIT_RESIDENCE],
  })
  update(
    @Args('input') input: UpdateUnitAssetInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<UnitAsset> {
    return this.assetService.update(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'removeUnitAsset' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.EDIT_RESIDENCE],
  })
  remove(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.assetService.remove(id, currentUser);
  }
}
