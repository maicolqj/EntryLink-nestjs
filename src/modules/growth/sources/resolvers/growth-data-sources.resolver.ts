import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { GrowthDataSource } from '../entities/growth-data-source.entity';
import {
  GrowthApproveSourceCostInput,
  GrowthCreateDataSourceInput,
  GrowthReviewSourceLegalInput,
  GrowthSetSourceStatusInput,
  GrowthUpdateDataSourceInput,
} from '../dto/inputs/data-source.inputs';
import { DataSourcesService } from '../services/data-sources.service';

@Resolver(() => GrowthDataSource)
export class GrowthDataSourcesResolver {
  constructor(private readonly sources: DataSourcesService) {}

  @Auth({ permissions: [ValidPermissions.VIEW_GROWTH_SOURCES] })
  @Query(() => [GrowthDataSource], { name: 'growthDataSources' })
  growthDataSources(): Promise<GrowthDataSource[]> {
    return this.sources.list();
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_SOURCES] })
  @Mutation(() => GrowthDataSource, {
    name: 'growthCreateDataSource',
    description:
      'Registra una fuente. Nace PENDING_APPROVAL y sin revisión jurídica.',
  })
  growthCreateDataSource(
    @Args('input') input: GrowthCreateDataSourceInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.sources.create(input, actor);
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_SOURCES] })
  @Mutation(() => GrowthDataSource, {
    name: 'growthUpdateDataSource',
    description:
      'Edita una fuente. Cambiar términos, finalidad, tipo, URL o automatización ' +
      'anula la revisión jurídica y la aprobación de costo.',
  })
  growthUpdateDataSource(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthUpdateDataSourceInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.sources.update(id, input, actor);
  }

  @Auth({ permissions: [ValidPermissions.REVIEW_GROWTH_SOURCES_LEGAL] })
  @Mutation(() => GrowthDataSource, { name: 'growthReviewDataSourceLegal' })
  growthReviewDataSourceLegal(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthReviewSourceLegalInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.sources.reviewLegal(id, input, actor);
  }

  @Auth({ permissions: [ValidPermissions.APPROVE_GROWTH_PAID_SOURCES] })
  @Mutation(() => GrowthDataSource, {
    name: 'growthApproveDataSourceCost',
    description:
      'Aprueba costo, presupuesto mensual y tope de una fuente de pago. No la activa.',
  })
  growthApproveDataSourceCost(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthApproveSourceCostInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.sources.approveCost(id, input, actor);
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_SOURCES] })
  @Mutation(() => GrowthDataSource, { name: 'growthSetDataSourceStatus' })
  growthSetDataSourceStatus(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthSetSourceStatusInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthDataSource> {
    return this.sources.setStatus(id, input, actor);
  }
}
