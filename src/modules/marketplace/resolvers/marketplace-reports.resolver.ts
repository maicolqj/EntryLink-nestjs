import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { MarketplaceListingReport } from '../entities/marketplace-listing-report.entity';
import { MarketplaceReportsService } from '../services/marketplace-reports.service';
import { MarketplaceReportStatus } from '../enums/marketplace-report-status.enum';
import { ReportListingInput } from '../dto/inputs/report-listing.input';
import { ResolveListingReportInput } from '../dto/inputs/resolve-listing-report.input';
import { PaginatedListingReportsResponse } from '../dto/responses/paginated-listing-reports.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';

@RequireModule(ComplexModule.CLASIFICADOS)
@Resolver(() => MarketplaceListingReport)
export class MarketplaceReportsResolver {
  constructor(private readonly reportsService: MarketplaceReportsService) {}

  /**
   * La bandeja de reportes. Solo quien modera: la lista dice quién reportó a
   * quién, que es justo lo que no puede salir del tablero.
   */
  @Query(() => PaginatedListingReportsResponse, { name: 'listingReports' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.MANAGE_LISTING_REPORTS],
  })
  listingReports(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput,
    @Args('status', { type: () => MarketplaceReportStatus, nullable: true })
    status: MarketplaceReportStatus,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedListingReportsResponse> {
    return this.reportsService.findByComplex(
      complexId,
      pagination ?? { page: 1, limit: 10 },
      status,
      currentUser,
    );
  }

  @Mutation(() => MarketplaceListingReport, { name: 'reportListing' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_MARKETPLACE],
  })
  reportListing(
    @Args('input') input: ReportListingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListingReport> {
    return this.reportsService.report(input, currentUser);
  }

  @Mutation(() => MarketplaceListingReport, { name: 'resolveListingReport' })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
    permissions: [ValidPermissions.MANAGE_LISTING_REPORTS],
  })
  resolveListingReport(
    @Args('input') input: ResolveListingReportInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListingReport> {
    return this.reportsService.resolve(input, currentUser);
  }
}
