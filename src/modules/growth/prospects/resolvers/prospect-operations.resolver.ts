import {
  Args,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { ValidPermissions as P } from '../../../permissions/enums/valid-permissions';
import { ValidRoles } from '../../../roles/enums/valid-roles';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { actorHas } from '../../shared/growth-actor';
import { GrowthEntityType } from '../../shared/growth.enums';
import {
  OrganizationChannel,
  PersonChannel,
} from '../entities/channels.entity';
import { Evidence } from '../entities/evidence.entity';
import { GrowthSettings } from '../entities/growth-settings.entity';
import { Person } from '../entities/person.entity';
import { ProspectAssignment } from '../entities/prospect-assignment.entity';
import { Employment, PropertyManagement } from '../entities/relations.entity';
import { GrowthProspectKind, GrowthValidationStatus } from '../prospects.enums';
import {
  GrowthAddEvidenceInput,
  GrowthVerifyEvidenceInput,
} from '../dto/inputs/evidence.inputs';
import {
  GrowthAssignProspectInput,
  GrowthChannelInput,
  GrowthDecideValidationInput,
  GrowthEndRelationInput,
  GrowthLinkEmploymentInput,
  GrowthPersonChannelInput,
  GrowthProspectRefInput,
  GrowthReopenInput,
  GrowthSetContactStatusInput,
  GrowthSetLegalBasisInput,
  GrowthSetPropertyManagerInput,
  GrowthUpdateSettingsInput,
} from '../dto/inputs/relations.inputs';
import {
  GrowthProspectDashboard,
  GrowthReviewItem,
  GrowthValidationChecklist,
} from '../dto/responses/prospect.responses';
import { AssignmentsService } from '../services/assignments.service';
import { ChannelsService } from '../services/channels.service';
import {
  EvidencesService,
  PERSONAL_EVIDENCE_TYPES,
} from '../services/evidences.service';
import { LegalBasisService } from '../services/legal-basis.service';
import { ProspectDashboardService } from '../services/prospect-dashboard.service';
import { RelationshipsService } from '../services/relationships.service';
import { ValidationService } from '../services/validation.service';
import { maskObservedValue } from '../shared/masking';
import { ProspectEventsService } from '../services/prospect-events.service';

/**
 * Operaciones de EntryLink Prospect: canales, relaciones, evidencias,
 * validación, asignación, base jurídica, configuración y dashboard.
 * No existe ninguna operación de borrado físico.
 */
@Resolver()
export class GrowthProspectOperationsResolver {
  constructor(
    private readonly channels: ChannelsService,
    private readonly relationships: RelationshipsService,
    private readonly evidences: EvidencesService,
    private readonly validation: ValidationService,
    private readonly assignments: AssignmentsService,
    private readonly legal: LegalBasisService,
    private readonly dashboard: ProspectDashboardService,
    private readonly events: ProspectEventsService,
  ) {}

  // ── Canales ────────────────────────────────────────────────────────────────

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => OrganizationChannel, {
    name: 'growthAddOrganizationChannel',
    description: 'Se consulta la lista de exclusión antes de guardar.',
  })
  growthAddOrganizationChannel(
    @Args('organizationId', { type: () => ID }) organizationId: string,
    @Args('input') input: GrowthChannelInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<OrganizationChannel> {
    return this.channels
      .addToOrganization(organizationId, input, actor)
      .then((r) =>
        this.events.after(
          r,
          GrowthProspectKind.ORGANIZATION,
          r.organizationId,
          true,
        ),
      );
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => PersonChannel, {
    name: 'growthAddPersonChannel',
    description:
      'Se consulta la lista de exclusión antes de guardar. Registrar un canal no autoriza contacto.',
  })
  growthAddPersonChannel(
    @Args('personId', { type: () => ID }) personId: string,
    @Args('input') input: GrowthPersonChannelInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<PersonChannel> {
    return this.channels
      .addToPerson(personId, input, actor)
      .then((r) =>
        this.events.after(r, GrowthProspectKind.PERSON, r.personId, true),
      );
  }

  @Auth({ permissions: [P.VALIDATE_GROWTH_PROSPECTS] })
  @Mutation(() => OrganizationChannel, {
    name: 'growthVerifyOrganizationChannel',
  })
  growthVerifyOrganizationChannel(
    @Args('channelId', { type: () => ID }) channelId: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<OrganizationChannel> {
    return this.channels
      .verify(GrowthProspectKind.ORGANIZATION, channelId, actor)
      .then((r) => {
        const c = r as OrganizationChannel;
        return this.events.after(
          c,
          GrowthProspectKind.ORGANIZATION,
          c.organizationId,
        );
      });
  }

  @Auth({ permissions: [P.VALIDATE_GROWTH_PROSPECTS] })
  @Mutation(() => PersonChannel, { name: 'growthVerifyPersonChannel' })
  growthVerifyPersonChannel(
    @Args('channelId', { type: () => ID }) channelId: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<PersonChannel> {
    return this.channels
      .verify(GrowthProspectKind.PERSON, channelId, actor)
      .then((r) => {
        const c = r as PersonChannel;
        return this.events.after(c, GrowthProspectKind.PERSON, c.personId);
      });
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Boolean, {
    name: 'growthDiscardChannel',
    description:
      'Retira un canal de uso (borrado lógico; queda en el historial).',
  })
  growthDiscardChannel(
    @Args('owner', { type: () => GrowthProspectKind })
    owner: GrowthProspectKind,
    @Args('channelId', { type: () => ID }) channelId: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<boolean> {
    if (owner === GrowthProspectKind.PROPERTY) return Promise.resolve(false);
    return this.channels.remove(owner, channelId, actor);
  }

  // ── Relaciones ─────────────────────────────────────────────────────────────

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Employment, { name: 'growthLinkEmployment' })
  growthLinkEmployment(
    @Args('input') input: GrowthLinkEmploymentInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Employment> {
    return this.relationships
      .linkEmployment(input, actor)
      .then((r) =>
        this.events.after(r, GrowthProspectKind.PERSON, r.personId, true),
      );
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Employment, { name: 'growthEndEmployment' })
  growthEndEmployment(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthEndRelationInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Employment> {
    return this.relationships.endEmployment(id, input, actor);
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => PropertyManagement, {
    name: 'growthSetPropertyManager',
    description:
      'Registrar una administración CURRENT cierra la vigente anterior.',
  })
  growthSetPropertyManager(
    @Args('input') input: GrowthSetPropertyManagerInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<PropertyManagement> {
    // Recalcula el puntaje de todos los que han administrado la copropiedad.
    return this.relationships
      .setPropertyManager(input, actor)
      .then((r) =>
        this.events.after(r, GrowthProspectKind.PROPERTY, r.propertyId),
      );
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => PropertyManagement, { name: 'growthEndPropertyManagement' })
  growthEndPropertyManagement(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthEndRelationInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<PropertyManagement> {
    return this.relationships
      .endPropertyManagement(id, input, actor)
      .then((r) =>
        this.events.after(r, GrowthProspectKind.PROPERTY, r.propertyId),
      );
  }

  // ── Evidencias ─────────────────────────────────────────────────────────────

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => [Evidence], { name: 'growthEvidences' })
  growthEvidences(
    @Args('entityType', { type: () => GrowthEntityType })
    entityType: GrowthEntityType,
    @Args('entityId', { type: () => ID }) entityId: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Evidence[]> {
    return this.evidences.listFor(entityType, entityId, actor);
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Evidence, { name: 'growthAddEvidence' })
  growthAddEvidence(
    @Args('input') input: GrowthAddEvidenceInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Evidence> {
    return this.evidences.add(input, actor);
  }

  @Auth({ permissions: [P.VALIDATE_GROWTH_PROSPECTS] })
  @Mutation(() => Evidence, {
    name: 'growthVerifyEvidence',
    description:
      'Quien capturó la evidencia no la verifica (separación de funciones).',
  })
  growthVerifyEvidence(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthVerifyEvidenceInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Evidence> {
    return this.evidences.verify(id, input, actor);
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Evidence, {
    name: 'growthMarkEvidenceObsolete',
    description: 'Las evidencias no se borran: quedan obsoletas con su motivo.',
  })
  growthMarkEvidenceObsolete(
    @Args('id', { type: () => ID }) id: string,
    @Args('note') note: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Evidence> {
    return this.evidences.markObsolete(id, note, actor);
  }

  // ── Validación ─────────────────────────────────────────────────────────────

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => [GrowthReviewItem], { name: 'growthReviewQueue' })
  growthReviewQueue(
    @CurrentUser() actor: JwtAccessPayload,
    @Args('statuses', { type: () => [GrowthValidationStatus], nullable: true })
    statuses?: GrowthValidationStatus[],
    @Args('takenByMe', { nullable: true }) takenByMe?: boolean,
  ): Promise<GrowthReviewItem[]> {
    return this.validation.queue(
      actor,
      statuses?.length ? statuses : undefined,
      !!takenByMe,
    );
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => GrowthValidationChecklist, { name: 'growthValidationChecklist' })
  growthValidationChecklist(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthValidationChecklist> {
    return this.validation.checklist(prospect, actor);
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => GrowthReviewItem, { name: 'growthSubmitForReview' })
  growthSubmitForReview(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.validation.submit(prospect, actor);
  }

  @Auth({ permissions: [P.VALIDATE_GROWTH_PROSPECTS] })
  @Mutation(() => GrowthReviewItem, { name: 'growthTakeForValidation' })
  growthTakeForValidation(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.validation.take(prospect, actor);
  }

  @Auth({ permissions: [P.VALIDATE_GROWTH_PROSPECTS] })
  @Mutation(() => GrowthReviewItem, { name: 'growthReleaseValidation' })
  growthReleaseValidation(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.validation.release(prospect, actor);
  }

  @Auth({ permissions: [P.VALIDATE_GROWTH_PROSPECTS] })
  @Mutation(() => GrowthReviewItem, {
    name: 'growthDecideValidation',
    description:
      'VALIDATED exige la lista de requisitos completa. Validar nunca autoriza contacto.',
  })
  growthDecideValidation(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @Args('input') input: GrowthDecideValidationInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.validation
      .decide(prospect, input, actor)
      .then((r) => this.events.after(r, r.kind, r.id));
  }

  @Auth({ permissions: [P.VALIDATE_GROWTH_PROSPECTS] })
  @Mutation(() => GrowthReviewItem, { name: 'growthReopenValidation' })
  growthReopenValidation(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @Args('input') input: GrowthReopenInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.validation.reopen(prospect, input.reason, actor);
  }

  // ── Asignación ─────────────────────────────────────────────────────────────

  @Auth({ permissions: [P.ASSIGN_GROWTH_PROSPECTS] })
  @Mutation(() => ProspectAssignment, {
    name: 'growthAssignProspect',
    description:
      'Reasignar cierra la asignación vigente y conserva el historial.',
  })
  growthAssignProspect(
    @Args('input') input: GrowthAssignProspectInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ProspectAssignment> {
    return this.assignments.assign(input, actor);
  }

  @Auth({ permissions: [P.ASSIGN_GROWTH_PROSPECTS] })
  @Mutation(() => Boolean, { name: 'growthUnassignProspect' })
  growthUnassignProspect(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<boolean> {
    return this.assignments.unassign(prospect, actor);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => [ProspectAssignment], { name: 'growthAssignmentHistory' })
  growthAssignmentHistory(
    @Args('prospect') prospect: GrowthProspectRefInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ProspectAssignment[]> {
    return this.assignments.history(prospect, actor);
  }

  // ── Base jurídica y contacto ───────────────────────────────────────────────

  @Auth({ permissions: [P.REVIEW_GROWTH_LEGAL_BASIS] })
  @Mutation(() => Person, {
    name: 'growthSetPersonLegalBasis',
    description:
      'Registra la base jurídica con su soporte. Volver a PENDING_LEGAL_REVIEW revoca el contacto.',
  })
  growthSetPersonLegalBasis(
    @Args('personId', { type: () => ID }) personId: string,
    @Args('input') input: GrowthSetLegalBasisInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Person> {
    return this.legal.setLegalBasis(personId, input, actor);
  }

  @Auth({ permissions: [P.AUTHORIZE_GROWTH_CONTACT] })
  @Mutation(() => Person, {
    name: 'growthSetPersonContactStatus',
    description:
      'AUTHORIZED exige base jurídica válida y documentada y persona validada (también lo impone la base de datos).',
  })
  growthSetPersonContactStatus(
    @Args('personId', { type: () => ID }) personId: string,
    @Args('input') input: GrowthSetContactStatusInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Person> {
    return this.legal.setContactStatus(personId, input, actor);
  }

  // ── Dashboard y configuración ──────────────────────────────────────────────

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => GrowthProspectDashboard, { name: 'growthProspectDashboard' })
  growthProspectDashboard(
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthProspectDashboard> {
    return this.dashboard.dashboard(actor);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => GrowthSettings, { name: 'growthSettings' })
  growthSettings(): Promise<GrowthSettings> {
    return this.dashboard.settings();
  }

  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  @Mutation(() => GrowthSettings, {
    name: 'growthUpdateSettings',
    description:
      'Solo SUPER_ADMIN. Incluye desactivar la excepción de auto-validación.',
  })
  growthUpdateSettings(
    @Args('input') input: GrowthUpdateSettingsInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthSettings> {
    return this.dashboard.updateSettings(input, actor);
  }
}

@Resolver(() => Evidence)
export class GrowthEvidenceResolver {
  /** Evidencias de personas y sus canales: enmascaradas sin permiso. */
  @ResolveField(() => String, { nullable: true })
  observedValue(
    @Parent() evidence: Evidence,
    @CurrentUser() actor: JwtAccessPayload,
  ): string | null {
    const value = evidence.observedValue ?? null;
    if (!value) return value;
    if (
      PERSONAL_EVIDENCE_TYPES.has(evidence.entityType) &&
      !actorHas(actor, P.VIEW_GROWTH_CONTACT_DATA)
    ) {
      return evidence.field === 'fullName' ? value : maskObservedValue(value);
    }
    return value;
  }
}
