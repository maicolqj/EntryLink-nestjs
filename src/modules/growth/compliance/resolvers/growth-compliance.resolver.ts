import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { DataSubjectRequest } from '../entities/data-subject-request.entity';
import { LegalHold } from '../entities/legal-hold.entity';
import { Suppression } from '../entities/suppression.entity';
import {
  GrowthCloseDataSubjectRequestInput,
  GrowthCreateDataSubjectRequestInput,
  GrowthDataSubjectRequestFilterInput,
  GrowthExtendDataSubjectRequestInput,
} from '../dto/inputs/data-subject-request.inputs';
import {
  GrowthCreateLegalHoldInput,
  GrowthLegalHoldFilterInput,
  GrowthReleaseLegalHoldInput,
} from '../dto/inputs/legal-hold.inputs';
import {
  GrowthAddSuppressionInput,
  GrowthCheckSuppressionInput,
  GrowthLiftSuppressionInput,
  GrowthSuppressionFilterInput,
} from '../dto/inputs/suppression.inputs';
import {
  GrowthSuppressionKeyStatus,
  PaginatedGrowthSuppressionsResponse,
} from '../dto/responses/suppression.responses';
import { DataSubjectRequestsService } from '../services/data-subject-requests.service';
import { LegalHoldsService } from '../services/legal-holds.service';
import { SuppressionsService } from '../services/suppressions.service';

/**
 * Lista de exclusión, solicitudes de titulares y retenciones legales.
 * A propósito NO existen: borrar una exclusión, editar una exclusión, borrar
 * una solicitud ni borrar una retención. La spec de integridad lo verifica.
 */
@Resolver()
export class GrowthComplianceResolver {
  constructor(
    private readonly suppressions: SuppressionsService,
    private readonly requests: DataSubjectRequestsService,
    private readonly holds: LegalHoldsService,
  ) {}

  // ── Lista de exclusión ───────────────────────────────────────────────────

  @Auth({ permissions: [ValidPermissions.ADD_GROWTH_SUPPRESSIONS] })
  @Query(() => Boolean, {
    name: 'growthIsSuppressed',
    description:
      'true = el dato está excluido y no se debe contactar por ese canal',
  })
  growthIsSuppressed(
    @Args('input') input: GrowthCheckSuppressionInput,
  ): Promise<boolean> {
    return this.suppressions.isSuppressed(input);
  }

  @Auth({ permissions: [ValidPermissions.VIEW_GROWTH_SUPPRESSIONS] })
  @Query(() => PaginatedGrowthSuppressionsResponse, {
    name: 'growthSuppressions',
  })
  growthSuppressions(
    @Args('filter', { nullable: true }) filter?: GrowthSuppressionFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedGrowthSuppressionsResponse> {
    return this.suppressions.list(
      filter ?? {},
      pagination ?? { page: 1, limit: 25 },
    );
  }

  @Auth({ permissions: [ValidPermissions.VIEW_GROWTH_SUPPRESSIONS] })
  @Query(() => GrowthSuppressionKeyStatus, {
    name: 'growthSuppressionKeyStatus',
  })
  growthSuppressionKeyStatus(): Promise<GrowthSuppressionKeyStatus> {
    return this.suppressions.keyStatus();
  }

  @Auth({ permissions: [ValidPermissions.ADD_GROWTH_SUPPRESSIONS] })
  @Mutation(() => Suppression, {
    name: 'growthAddSuppression',
    description:
      'Agrega un dato a la lista de exclusión. Si ya estaba, devuelve la existente.',
  })
  growthAddSuppression(
    @Args('input') input: GrowthAddSuppressionInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Suppression> {
    return this.suppressions.add(input, actor);
  }

  @Auth({ permissions: [ValidPermissions.LIFT_GROWTH_SUPPRESSIONS] })
  @Mutation(() => Suppression, {
    name: 'growthLiftSuppression',
    description:
      'Levanta una exclusión con fundamento jurídico y soporte. No la borra: queda en el historial.',
  })
  growthLiftSuppression(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthLiftSuppressionInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Suppression> {
    return this.suppressions.lift(id, input, actor);
  }

  // ── Solicitudes de titulares ─────────────────────────────────────────────

  @Auth({ permissions: [ValidPermissions.VIEW_GROWTH_PRIVACY_REQUESTS] })
  @Query(() => [DataSubjectRequest], { name: 'growthDataSubjectRequests' })
  growthDataSubjectRequests(
    @Args('filter', { nullable: true })
    filter?: GrowthDataSubjectRequestFilterInput,
  ): Promise<DataSubjectRequest[]> {
    return this.requests.list(filter ?? {});
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_PRIVACY_REQUESTS] })
  @Mutation(() => DataSubjectRequest, {
    name: 'growthCreateDataSubjectRequest',
  })
  growthCreateDataSubjectRequest(
    @Args('input') input: GrowthCreateDataSubjectRequestInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<DataSubjectRequest> {
    return this.requests.create(input, actor);
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_PRIVACY_REQUESTS] })
  @Mutation(() => DataSubjectRequest, { name: 'growthStartDataSubjectRequest' })
  growthStartDataSubjectRequest(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<DataSubjectRequest> {
    return this.requests.start(id, actor);
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_PRIVACY_REQUESTS] })
  @Mutation(() => DataSubjectRequest, {
    name: 'growthExtendDataSubjectRequest',
  })
  growthExtendDataSubjectRequest(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthExtendDataSubjectRequestInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<DataSubjectRequest> {
    return this.requests.extend(id, input, actor);
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_PRIVACY_REQUESTS] })
  @Mutation(() => DataSubjectRequest, {
    name: 'growthCloseDataSubjectRequest',
    description:
      'Cierra la solicitud y borra el medio de respuesta. Supresión, revocación ' +
      'u oposición resueltas agregan al titular a la lista de exclusión.',
  })
  growthCloseDataSubjectRequest(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthCloseDataSubjectRequestInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<DataSubjectRequest> {
    return this.requests.close(id, input, actor);
  }

  // ── Retenciones legales ──────────────────────────────────────────────────

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_LEGAL_HOLDS] })
  @Query(() => [LegalHold], { name: 'growthLegalHolds' })
  growthLegalHolds(
    @Args('filter', { nullable: true }) filter?: GrowthLegalHoldFilterInput,
  ): Promise<LegalHold[]> {
    return this.holds.list(filter ?? {});
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_LEGAL_HOLDS] })
  @Mutation(() => LegalHold, { name: 'growthCreateLegalHold' })
  growthCreateLegalHold(
    @Args('input') input: GrowthCreateLegalHoldInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<LegalHold> {
    return this.holds.create(input, actor);
  }

  @Auth({ permissions: [ValidPermissions.MANAGE_GROWTH_LEGAL_HOLDS] })
  @Mutation(() => LegalHold, { name: 'growthReleaseLegalHold' })
  growthReleaseLegalHold(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthReleaseLegalHoldInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<LegalHold> {
    return this.holds.release(id, input, actor);
  }
}
