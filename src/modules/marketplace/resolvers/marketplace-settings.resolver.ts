import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { MarketplaceSettings } from '../entities/marketplace-settings.entity';
import { MarketplaceSettingsService } from '../services/marketplace-settings.service';
import { UpdateMarketplaceSettingsInput } from '../dto/inputs/update-marketplace-settings.input';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';

@RequireModule(ComplexModule.CLASIFICADOS)
@Resolver(() => MarketplaceSettings)
export class MarketplaceSettingsResolver {
  constructor(private readonly settingsService: MarketplaceSettingsService) {}

  /**
   * Los ajustes los lee también el residente: la app necesita saber si hay
   * moderación previa —para avisarle que su publicación va a revisión— y si el
   * conjunto admite avisos de "busco".
   */
  @Query(() => MarketplaceSettings, { name: 'marketplaceSettings' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_MARKETPLACE],
  })
  marketplaceSettings(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceSettings> {
    return this.settingsService.findByComplex(complexId, currentUser);
  }

  @Mutation(() => MarketplaceSettings, { name: 'updateMarketplaceSettings' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.MANAGE_MARKETPLACE_SETTINGS],
  })
  updateMarketplaceSettings(
    @Args('input') input: UpdateMarketplaceSettingsInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceSettings> {
    return this.settingsService.update(input, currentUser);
  }
}
