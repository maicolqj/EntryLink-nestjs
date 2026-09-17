import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { MarketplaceCategory } from '../entities/marketplace-category.entity';
import { MarketplaceCategoriesService } from '../services/marketplace-categories.service';
import { MarketplaceCategoryKind } from '../enums/marketplace-category-kind.enum';
import { UpsertMarketplaceCategoryInput } from '../dto/inputs/upsert-marketplace-category.input';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';

@RequireModule(ComplexModule.CLASIFICADOS)
@Resolver(() => MarketplaceCategory)
export class MarketplaceCategoriesResolver {
  constructor(
    private readonly categoriesService: MarketplaceCategoriesService,
  ) {}

  /**
   * Las categorías de la vitrina. `includeInactive` solo lo atiende de verdad
   * para quien modera: el servicio decide, no el argumento.
   */
  @Query(() => [MarketplaceCategory], { name: 'marketplaceCategories' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_MARKETPLACE],
  })
  marketplaceCategories(
    @Args('complexId') complexId: string,
    @Args('kind', { type: () => MarketplaceCategoryKind, nullable: true })
    kind: MarketplaceCategoryKind,
    @Args('includeInactive', { nullable: true }) includeInactive: boolean,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceCategory[]> {
    const isModerator = currentUser.roles?.some((role) =>
      [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL].includes(role),
    );

    return this.categoriesService.findByComplex(complexId, currentUser, {
      kind: kind ?? MarketplaceCategoryKind.CLASSIFIED,
      includeInactive: !!includeInactive && !!isModerator,
    });
  }

  @Mutation(() => MarketplaceCategory, { name: 'upsertMarketplaceCategory' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.MANAGE_MARKETPLACE_SETTINGS],
  })
  upsertMarketplaceCategory(
    @Args('input') input: UpsertMarketplaceCategoryInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceCategory> {
    return this.categoriesService.upsert(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'removeMarketplaceCategory' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.MANAGE_MARKETPLACE_SETTINGS],
  })
  removeMarketplaceCategory(
    @Args('categoryId') categoryId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.categoriesService.remove(categoryId, currentUser);
  }
}
