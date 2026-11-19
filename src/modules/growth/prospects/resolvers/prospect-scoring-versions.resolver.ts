import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ValidPermissions as P } from '../../../permissions/enums/valid-permissions';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import {
  GrowthCreateScoringDraftInput,
  GrowthUpdateScoringDraftInput,
} from '../dto/inputs/scoring-versions.inputs';
import { paginate } from '../dto/responses/prospect.responses';
import { GrowthScoringSimulation } from '../dto/responses/scoring-simulation.responses';
import {
  GrowthScoringStatus,
  PaginatedGrowthScoreHistory,
} from '../dto/responses/scoring-versions.responses';
import { ScoringVersion } from '../entities/scoring-version.entity';
import {
  GrowthProspectKind,
  GrowthScoringVersionStatus,
} from '../prospects.enums';
import { ScoringVersionsService } from '../services/scoring-versions.service';

/**
 * Versiones de reglas y umbrales del scoring (1E-C-0); la regla completa
 * está en ScoringVersionsService. El scoring ordena prospectos: nunca
 * autoriza ni bloquea un contacto.
 */
@Resolver()
export class GrowthScoringVersionsResolver {
  constructor(private readonly versions: ScoringVersionsService) {}

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => [ScoringVersion], {
    name: 'growthScoringVersions',
    description: 'Versiones del scoring, de la más nueva a la más antigua',
  })
  growthScoringVersions(
    @Args('statuses', {
      type: () => [GrowthScoringVersionStatus],
      nullable: true,
    })
    statuses?: GrowthScoringVersionStatus[],
  ): Promise<ScoringVersion[]> {
    return this.versions.list(statuses);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => ScoringVersion, { name: 'growthScoringVersion' })
  growthScoringVersion(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ScoringVersion> {
    return this.versions.get(id);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => GrowthScoringStatus, {
    name: 'growthScoringStatus',
    description:
      'Versión activa y cuántos puntajes faltan por recalcular con ella',
  })
  growthScoringStatus(): Promise<GrowthScoringStatus> {
    return this.versions.status();
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => GrowthScoringSimulation, {
    name: 'growthCompareScoringVersion',
    description:
      'Compara una versión con la activa (mismo motor, sin guardar nada). Exige configurar o aprobar el scoring',
  })
  growthCompareScoringVersion(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
    @Args('sampleLimit', { type: () => Int, nullable: true })
    sampleLimit?: number,
  ): Promise<GrowthScoringSimulation> {
    return this.versions.compare(id, actor, sampleLimit ?? 25);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => PaginatedGrowthScoreHistory, {
    name: 'growthProspectScoreHistory',
    description:
      'Puntajes que tuvo un prospecto, con la versión que los produjo',
  })
  growthProspectScoreHistory(
    @Args('kind', { type: () => GrowthProspectKind }) kind: GrowthProspectKind,
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedGrowthScoreHistory> {
    const page = pagination ?? { page: 1, limit: 25 };
    // Las copropiedades no tienen puntaje propio.
    if (kind === GrowthProspectKind.PROPERTY) {
      return Promise.resolve(paginate([], 0, page));
    }
    return this.versions.history(kind, id, actor, page);
  }

  @Auth({ permissions: [P.MANAGE_GROWTH_SCORING] })
  @Mutation(() => ScoringVersion, {
    name: 'growthCreateScoringDraft',
    description: 'Crea un borrador copiando la versión activa (o la indicada)',
  })
  growthCreateScoringDraft(
    @Args('input') input: GrowthCreateScoringDraftInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ScoringVersion> {
    return this.versions.createDraft(input, actor);
  }

  @Auth({ permissions: [P.MANAGE_GROWTH_SCORING] })
  @Mutation(() => ScoringVersion, {
    name: 'growthUpdateScoringDraft',
    description: 'Cambia reglas, umbrales o notas de un borrador',
  })
  growthUpdateScoringDraft(
    @Args('input') input: GrowthUpdateScoringDraftInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ScoringVersion> {
    return this.versions.updateDraft(input, actor);
  }

  @Auth({ permissions: [P.MANAGE_GROWTH_SCORING] })
  @Mutation(() => ScoringVersion, {
    name: 'growthDiscardScoringDraft',
    description: 'Descarta un borrador (queda retirado, no se borra)',
  })
  growthDiscardScoringDraft(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ScoringVersion> {
    return this.versions.discardDraft(id, reason, actor);
  }

  @Auth({ permissions: [P.APPROVE_GROWTH_SCORING] })
  @Mutation(() => ScoringVersion, {
    name: 'growthActivateScoringVersion',
    description:
      'Aprueba y activa un borrador; retira la versión anterior y recalcula en segundo plano. No la aprueba quien la propuso o editó',
  })
  growthActivateScoringVersion(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ScoringVersion> {
    return this.versions.activate(id, actor);
  }
}
