import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ValidPermissions as P } from '../../../permissions/enums/valid-permissions';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import {
  DuplicateCandidate,
  MergeLog,
  ProspectScore,
  ScoringRule,
} from '../entities/dedupe-scoring.entity';
import { GrowthSettings } from '../entities/growth-settings.entity';
import {
  GrowthDuplicateFilterInput,
  GrowthMergeDuplicatesInput,
  GrowthScoringRuleInput,
  GrowthScoringThresholdsInput,
} from '../dto/inputs/dedupe-scoring.inputs';
import { GrowthProspectRefInput } from '../dto/inputs/relations.inputs';
import { PaginatedGrowthDuplicates } from '../dto/responses/prospect.responses';
import { DedupeService } from '../services/dedupe.service';
import { MergeService } from '../services/merge.service';
import { ProspectGuardsService } from '../services/prospect-guards.service';
import { ProspectEventsService } from '../services/prospect-events.service';
import { ScoringService } from '../services/scoring.service';

/**
 * Deduplicación (siempre con decisión humana) y scoring configurable.
 * El scoring ordena; no valida ni autoriza contacto.
 */
@Resolver()
export class GrowthDedupeScoringResolver {
  constructor(
    private readonly dedupe: DedupeService,
    private readonly mergeService: MergeService,
    private readonly scoring: ScoringService,
    private readonly guards: ProspectGuardsService,
    private readonly events: ProspectEventsService,
  ) {}

  // ── Duplicados ─────────────────────────────────────────────────────────────

  @Auth({ permissions: [P.VIEW_ALL_GROWTH_PROSPECTS] })
  @Query(() => PaginatedGrowthDuplicates, { name: 'growthDuplicateCandidates' })
  growthDuplicateCandidates(
    @Args('filter', { nullable: true }) filter?: GrowthDuplicateFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedGrowthDuplicates> {
    return this.dedupe.list(filter ?? {}, pagination ?? { page: 1, limit: 25 });
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Int, {
    name: 'growthScanDuplicates',
    description:
      'Busca ya mismo posibles duplicados de un registro. Devuelve cuántos pares propuso.',
  })
  async growthScanDuplicates(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<number> {
    await this.guards.findVisible(
      this.guards.manager,
      prospect.kind,
      prospect.id,
      actor,
    );
    return this.dedupe.scan(prospect.kind, prospect.id);
  }

  @Auth({ permissions: [P.MERGE_GROWTH_DUPLICATES] })
  @Mutation(() => DuplicateCandidate, { name: 'growthDismissDuplicate' })
  growthDismissDuplicate(
    @Args('id', { type: () => ID }) id: string,
    @Args('note') note: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<DuplicateCandidate> {
    return this.dedupe.dismiss(id, note, actor);
  }

  @Auth({ permissions: [P.MERGE_GROWTH_DUPLICATES] })
  @Mutation(() => MergeLog, {
    name: 'growthMergeDuplicates',
    description:
      'Fusión manual: valor elegido por campo en conflicto; relaciones y evidencias pasan al sobreviviente; nada se borra.',
  })
  growthMergeDuplicates(
    @Args('input') input: GrowthMergeDuplicatesInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<MergeLog> {
    return this.mergeService.merge(input, actor);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => [MergeLog], { name: 'growthMergeHistory' })
  async growthMergeHistory(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<MergeLog[]> {
    await this.guards.findVisible(
      this.guards.manager,
      prospect.kind,
      prospect.id,
      actor,
    );
    return this.mergeService.history(prospect.kind, prospect.id);
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => ProspectScore, { name: 'growthProspectScore', nullable: true })
  async growthProspectScore(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ProspectScore | null> {
    await this.guards.findVisible(
      this.guards.manager,
      prospect.kind,
      prospect.id,
      actor,
    );
    return this.scoring.getScore(prospect.kind, prospect.id);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => [ScoringRule], { name: 'growthScoringRules' })
  growthScoringRules(): Promise<ScoringRule[]> {
    return this.scoring.listRules();
  }

  @Auth({ permissions: [P.MANAGE_GROWTH_SCORING] })
  @Mutation(() => ScoringRule, { name: 'growthCreateScoringRule' })
  growthCreateScoringRule(
    @Args('input') input: GrowthScoringRuleInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ScoringRule> {
    return this.scoring.createRule(input, actor);
  }

  @Auth({ permissions: [P.MANAGE_GROWTH_SCORING] })
  @Mutation(() => ScoringRule, {
    name: 'growthUpdateScoringRule',
    description:
      'Cambiar una regla sube la versión y recalcula todos los puntajes.',
  })
  growthUpdateScoringRule(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthScoringRuleInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ScoringRule> {
    return this.scoring.updateRule(id, input, actor);
  }

  @Auth({ permissions: [P.MANAGE_GROWTH_SCORING] })
  @Mutation(() => GrowthSettings, { name: 'growthUpdateScoringThresholds' })
  growthUpdateScoringThresholds(
    @Args('input') input: GrowthScoringThresholdsInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthSettings> {
    return this.scoring.updateThresholds(input, actor);
  }

  @Auth({ permissions: [P.MANAGE_GROWTH_SCORING] })
  @Mutation(() => Boolean, {
    name: 'growthRescoreAll',
    description: 'Encola el recálculo de todos los puntajes.',
  })
  async growthRescoreAll(): Promise<boolean> {
    await this.events.rescoreAll();
    return true;
  }
}
