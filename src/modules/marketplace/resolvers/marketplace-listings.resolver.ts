import {
  Resolver,
  Query,
  Mutation,
  Args,
  ResolveField,
  Parent,
} from '@nestjs/graphql';

import { MarketplaceListing } from '../entities/marketplace-listing.entity';
import { MarketplaceListingsService } from '../services/marketplace-listings.service';
import { UpdateListingInput } from '../dto/inputs/update-listing.input';
import { FilterListingsInput } from '../dto/inputs/filter-listings.input';
import { ModerateListingInput } from '../dto/inputs/moderate-listing.input';
import { RegisterListingInterestInput } from '../dto/inputs/register-listing-interest.input';
import { PaginatedListingsResponse } from '../dto/responses/paginated-listings.response';
import { ListingContactResponse } from '../dto/responses/listing-contact.response';
import { MarketplaceStatsResponse } from '../dto/responses/marketplace-stats.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';

/** Quien vive en el conjunto y usa la vitrina. */
const RESIDENT_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.RESIDENT_ROL,
  ValidRoles.COUNCIL_ROL,
];

/** Quien modera. La portería y el supervisor no entran al módulo. */
const MODERATOR_ROLES = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL];

/**
 * El alta de una publicación NO está aquí: va por REST
 * (POST /api/v1/marketplace/listings) porque las fotos llegan como archivo y
 * GraphQL en este proyecto no recibe multipart.
 */
@RequireModule(ComplexModule.CLASIFICADOS)
@Resolver(() => MarketplaceListing)
export class MarketplaceListingsResolver {
  constructor(private readonly listingsService: MarketplaceListingsService) {}

  // ================================================================
  // QUERIES
  // ================================================================

  @Query(() => PaginatedListingsResponse, { name: 'marketplaceListings' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.VIEW_MARKETPLACE],
  })
  marketplaceListings(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput,
    @Args('filters', { nullable: true }) filters: FilterListingsInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedListingsResponse> {
    return this.listingsService.findByComplex(
      complexId,
      pagination ?? { page: 1, limit: 10 },
      filters ?? {},
      currentUser,
    );
  }

  /** Abre la ficha. Cuenta la visita salvo que mire su autor o quien modera. */
  @Query(() => MarketplaceListing, { name: 'marketplaceListing' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.VIEW_MARKETPLACE],
  })
  marketplaceListing(
    @Args('listingId') listingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.findByIdAndCountView(listingId, currentUser);
  }

  @Query(() => MarketplaceStatsResponse, { name: 'marketplaceStats' })
  @Auth({
    roles: MODERATOR_ROLES,
    permissions: [ValidPermissions.MODERATE_LISTINGS],
  })
  marketplaceStats(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceStatsResponse> {
    return this.listingsService.getStats(complexId, currentUser);
  }

  // ================================================================
  // MUTATIONS — DUEÑO DEL AVISO
  // ================================================================

  @Mutation(() => MarketplaceListing, { name: 'updateListing' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.PUBLISH_LISTING],
  })
  updateListing(
    @Args('input') input: UpdateListingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.update(input, currentUser);
  }

  @Mutation(() => MarketplaceListing, { name: 'submitListing' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.PUBLISH_LISTING],
  })
  submitListing(
    @Args('listingId') listingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.submit(listingId, currentUser);
  }

  @Mutation(() => MarketplaceListing, { name: 'pauseListing' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.PUBLISH_LISTING],
  })
  pauseListing(
    @Args('listingId') listingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.pause(listingId, currentUser);
  }

  @Mutation(() => MarketplaceListing, { name: 'resumeListing' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.PUBLISH_LISTING],
  })
  resumeListing(
    @Args('listingId') listingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.resume(listingId, currentUser);
  }

  @Mutation(() => MarketplaceListing, { name: 'markListingAsSold' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.PUBLISH_LISTING],
  })
  markListingAsSold(
    @Args('listingId') listingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.markAsSold(listingId, currentUser);
  }

  @Mutation(() => MarketplaceListing, { name: 'renewListing' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.PUBLISH_LISTING],
  })
  renewListing(
    @Args('listingId') listingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.renew(listingId, currentUser);
  }

  @Mutation(() => Boolean, { name: 'removeListing' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.PUBLISH_LISTING],
  })
  removeListing(
    @Args('listingId') listingId: string,
    @Args('reason', { nullable: true }) reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.listingsService.remove(listingId, reason, currentUser);
  }

  // ================================================================
  // MUTATIONS — QUIEN MIRA
  // ================================================================

  @Mutation(() => MarketplaceListing, { name: 'registerListingInterest' })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.VIEW_MARKETPLACE],
  })
  registerListingInterest(
    @Args('input') input: RegisterListingInterestInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.registerInterest(input, currentUser);
  }

  @Mutation(() => Boolean, {
    name: 'toggleListingFavorite',
    description: 'Devuelve true si quedó guardada como favorita',
  })
  @Auth({
    roles: RESIDENT_ROLES,
    permissions: [ValidPermissions.VIEW_MARKETPLACE],
  })
  toggleListingFavorite(
    @Args('listingId') listingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.listingsService.toggleFavorite(listingId, currentUser);
  }

  // ================================================================
  // MUTATIONS — MODERACIÓN
  // ================================================================

  @Mutation(() => MarketplaceListing, { name: 'approveListing' })
  @Auth({
    roles: MODERATOR_ROLES,
    permissions: [ValidPermissions.MODERATE_LISTINGS],
  })
  approveListing(
    @Args('input') input: ModerateListingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.approve(input, currentUser);
  }

  @Mutation(() => MarketplaceListing, { name: 'rejectListing' })
  @Auth({
    roles: MODERATOR_ROLES,
    permissions: [ValidPermissions.MODERATE_LISTINGS],
  })
  rejectListing(
    @Args('input') input: ModerateListingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    return this.listingsService.reject(input, currentUser);
  }

  // ================================================================
  // CAMPOS QUE DEPENDEN DE QUIÉN MIRA
  // ================================================================

  /**
   * Lo decide el servidor y no la pantalla: el teléfono depende del
   * consentimiento de su dueño y de lo que el conjunto permite, y replicar esa
   * regla en el cliente significaría mandarle el número igual y confiar en que
   * no lo pinte.
   */
  @ResolveField(() => ListingContactResponse, {
    description: 'Cómo contactar al publicador',
  })
  contact(
    @Parent() listing: MarketplaceListing,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ListingContactResponse> {
    return this.listingsService.resolveContact(listing, currentUser);
  }

  @ResolveField(() => Boolean, {
    description: 'Quien consulta la tiene guardada como favorita',
  })
  viewerHasFavorited(
    @Parent() listing: MarketplaceListing,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.listingsService.hasFavorited(listing.id, currentUser.sub);
  }

  @ResolveField(() => Boolean, {
    description: 'Quien consulta ya registró interés',
  })
  viewerHasContacted(
    @Parent() listing: MarketplaceListing,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.listingsService.hasContacted(listing.id, currentUser.sub);
  }

  @ResolveField(() => Boolean, {
    description: 'La publicación es de quien consulta',
  })
  viewerIsOwner(
    @Parent() listing: MarketplaceListing,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): boolean {
    return listing.ownerUserId === currentUser.sub;
  }
}
