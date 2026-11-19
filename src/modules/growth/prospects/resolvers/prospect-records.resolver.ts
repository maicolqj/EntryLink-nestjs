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
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { actorHas } from '../../shared/growth-actor';
import {
  OrganizationChannel,
  PersonChannel,
} from '../entities/channels.entity';
import { Organization } from '../entities/organization.entity';
import { Person } from '../entities/person.entity';
import { ProspectAssignment } from '../entities/prospect-assignment.entity';
import { Property } from '../entities/property.entity';
import { Employment, PropertyManagement } from '../entities/relations.entity';
import { GrowthProspectKind } from '../prospects.enums';
import {
  GrowthCreateOrganizationInput,
  GrowthCreatePersonInput,
  GrowthCreatePropertyInput,
  GrowthProspectFilterInput,
  GrowthUpdateOrganizationInput,
  GrowthUpdatePersonInput,
  GrowthUpdatePropertyInput,
} from '../dto/inputs/prospect.inputs';
import {
  PaginatedGrowthOrganizations,
  PaginatedGrowthPeople,
  PaginatedGrowthProperties,
} from '../dto/responses/prospect.responses';
import { AssignmentsService } from '../services/assignments.service';
import { ChannelsService } from '../services/channels.service';
import { OrganizationsService } from '../services/organizations.service';
import { PeopleService } from '../services/people.service';
import { PropertiesService } from '../services/properties.service';
import { RelationshipsService } from '../services/relationships.service';
import { maskChannel } from '../shared/masking';
import { ProspectEventsService } from '../services/prospect-events.service';
import { ScoringService } from '../services/scoring.service';
import { ProspectScore } from '../entities/dedupe-scoring.entity';

const PAGE = { page: 1, limit: 25 };

// ── Empresas ────────────────────────────────────────────────────────────────

@Resolver(() => Organization)
export class GrowthOrganizationsResolver {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly channelService: ChannelsService,
    private readonly relationships: RelationshipsService,
    private readonly assignments: AssignmentsService,
    private readonly events: ProspectEventsService,
    private readonly scoring: ScoringService,
  ) {}

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => PaginatedGrowthOrganizations, { name: 'growthOrganizations' })
  growthOrganizations(
    @CurrentUser() actor: JwtAccessPayload,
    @Args('filter', { nullable: true }) filter?: GrowthProspectFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedGrowthOrganizations> {
    return this.organizations.list(actor, filter ?? {}, pagination ?? PAGE);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => Organization, { name: 'growthOrganization' })
  growthOrganization(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Organization> {
    return this.organizations.get(id, actor);
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Organization, {
    name: 'growthCreateOrganization',
    description:
      'Registra una empresa (NEW) con evidencia de cada campo. Fuente ACTIVE obligatoria.',
  })
  growthCreateOrganization(
    @Args('input') input: GrowthCreateOrganizationInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Organization> {
    return this.organizations
      .create(input, actor)
      .then((r) =>
        this.events.after(r, GrowthProspectKind.ORGANIZATION, r.id, true),
      );
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Organization, {
    name: 'growthUpdateOrganization',
    description:
      'Si cambia la razón social o el NIT de una empresa validada, vuelve a revisión.',
  })
  growthUpdateOrganization(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthUpdateOrganizationInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Organization> {
    return this.organizations
      .update(id, input, actor)
      .then((r) =>
        this.events.after(r, GrowthProspectKind.ORGANIZATION, r.id, true),
      );
  }

  @ResolveField(() => [OrganizationChannel])
  channels(@Parent() org: Organization): Promise<OrganizationChannel[]> {
    return this.channelService.listForOrganization(org.id);
  }

  @ResolveField(() => [Employment], {
    description: 'Personas vinculadas (historial)',
  })
  employments(@Parent() org: Organization): Promise<Employment[]> {
    return this.relationships.employmentsOfOrganization(org.id);
  }

  @ResolveField(() => [PropertyManagement], {
    description: 'Copropiedades administradas (historial)',
  })
  managements(@Parent() org: Organization): Promise<PropertyManagement[]> {
    return this.relationships.managementsByOrganization(org.id);
  }

  @ResolveField(() => ProspectScore, {
    nullable: true,
    description:
      'Puntaje vigente con desglose (no valida ni autoriza contacto)',
  })
  score(@Parent() org: Organization): Promise<ProspectScore | null> {
    return this.scoring.getScore(GrowthProspectKind.ORGANIZATION, org.id);
  }

  @ResolveField(() => ProspectAssignment, { nullable: true })
  currentAssignment(
    @Parent() org: Organization,
  ): Promise<ProspectAssignment | null> {
    return this.assignments.currentFor(GrowthProspectKind.ORGANIZATION, org.id);
  }
}

@Resolver(() => OrganizationChannel)
export class GrowthOrganizationChannelResolver {
  /** Canal corporativo: no es dato personal, se muestra completo. */
  @ResolveField(() => String)
  value(@Parent() channel: OrganizationChannel): string {
    return channel.value;
  }
}

// ── Personas ────────────────────────────────────────────────────────────────

@Resolver(() => Person)
export class GrowthPeopleResolver {
  constructor(
    private readonly people: PeopleService,
    private readonly channelService: ChannelsService,
    private readonly relationships: RelationshipsService,
    private readonly assignments: AssignmentsService,
    private readonly events: ProspectEventsService,
    private readonly scoring: ScoringService,
  ) {}

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => PaginatedGrowthPeople, { name: 'growthPeople' })
  growthPeople(
    @CurrentUser() actor: JwtAccessPayload,
    @Args('filter', { nullable: true }) filter?: GrowthProspectFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedGrowthPeople> {
    return this.people.list(actor, filter ?? {}, pagination ?? PAGE);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => Person, { name: 'growthPerson' })
  growthPerson(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Person> {
    return this.people.get(id, actor);
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Person, {
    name: 'growthCreatePerson',
    description:
      'Registra una persona con base jurídica PENDING_LEGAL_REVIEW y contacto NOT_AUTHORIZED.',
  })
  growthCreatePerson(
    @Args('input') input: GrowthCreatePersonInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Person> {
    return this.people
      .create(input, actor)
      .then((r) => this.events.after(r, GrowthProspectKind.PERSON, r.id, true));
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Person, { name: 'growthUpdatePerson' })
  growthUpdatePerson(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthUpdatePersonInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Person> {
    return this.people
      .update(id, input, actor)
      .then((r) => this.events.after(r, GrowthProspectKind.PERSON, r.id, true));
  }

  @ResolveField(() => [PersonChannel])
  channels(@Parent() person: Person): Promise<PersonChannel[]> {
    return this.channelService.listForPerson(person.id);
  }

  @ResolveField(() => [Employment])
  employments(@Parent() person: Person): Promise<Employment[]> {
    return this.relationships.employmentsOfPerson(person.id);
  }

  @ResolveField(() => [PropertyManagement], {
    description: 'Copropiedades que administra directamente (independiente)',
  })
  managements(@Parent() person: Person): Promise<PropertyManagement[]> {
    return this.relationships.managementsByPerson(person.id);
  }

  @ResolveField(() => ProspectScore, {
    nullable: true,
    description: 'Solo administradores independientes tienen puntaje',
  })
  score(@Parent() person: Person): Promise<ProspectScore | null> {
    return this.scoring.getScore(GrowthProspectKind.PERSON, person.id);
  }

  @ResolveField(() => ProspectAssignment, { nullable: true })
  currentAssignment(
    @Parent() person: Person,
  ): Promise<ProspectAssignment | null> {
    return this.assignments.currentFor(GrowthProspectKind.PERSON, person.id);
  }
}

@Resolver(() => PersonChannel)
export class GrowthPersonChannelResolver {
  /**
   * Dato personal: sin VIEW_GROWTH_CONTACT_DATA se entrega enmascarado.
   * El enmascaramiento ocurre aquí (servidor), no en la interfaz.
   */
  @ResolveField(() => String)
  value(
    @Parent() channel: PersonChannel,
    @CurrentUser() actor: JwtAccessPayload,
  ): string {
    return actorHas(actor, P.VIEW_GROWTH_CONTACT_DATA)
      ? channel.value
      : maskChannel(channel.kind, channel.value);
  }

  @ResolveField(() => Boolean, {
    description: 'true si el valor llega enmascarado por falta de permiso',
  })
  masked(@CurrentUser() actor: JwtAccessPayload): boolean {
    return !actorHas(actor, P.VIEW_GROWTH_CONTACT_DATA);
  }
}

// ── Copropiedades ───────────────────────────────────────────────────────────

@Resolver(() => Property)
export class GrowthPropertiesResolver {
  constructor(
    private readonly properties: PropertiesService,
    private readonly relationships: RelationshipsService,
    private readonly assignments: AssignmentsService,
    private readonly events: ProspectEventsService,
  ) {}

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => PaginatedGrowthProperties, { name: 'growthProperties' })
  growthProperties(
    @CurrentUser() actor: JwtAccessPayload,
    @Args('filter', { nullable: true }) filter?: GrowthProspectFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedGrowthProperties> {
    return this.properties.list(actor, filter ?? {}, pagination ?? PAGE);
  }

  @Auth({ permissions: [P.VIEW_GROWTH_PROSPECTS] })
  @Query(() => Property, { name: 'growthProperty' })
  growthProperty(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Property> {
    return this.properties.get(id, actor);
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Property, { name: 'growthCreateProperty' })
  growthCreateProperty(
    @Args('input') input: GrowthCreatePropertyInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Property> {
    return this.properties
      .create(input, actor)
      .then((r) =>
        this.events.after(r, GrowthProspectKind.PROPERTY, r.id, true),
      );
  }

  @Auth({ permissions: [P.EDIT_GROWTH_PROSPECTS] })
  @Mutation(() => Property, {
    name: 'growthUpdateProperty',
    description:
      'Si cambia el nombre o la dirección de una copropiedad validada, vuelve a revisión.',
  })
  growthUpdateProperty(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: GrowthUpdatePropertyInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<Property> {
    return this.properties
      .update(id, input, actor)
      .then((r) =>
        this.events.after(r, GrowthProspectKind.PROPERTY, r.id, true),
      );
  }

  @ResolveField(() => [PropertyManagement], {
    description: 'Historial de administración',
  })
  managements(@Parent() property: Property): Promise<PropertyManagement[]> {
    return this.relationships.managementsOfProperty(property.id);
  }

  @ResolveField(() => ProspectAssignment, { nullable: true })
  currentAssignment(
    @Parent() property: Property,
  ): Promise<ProspectAssignment | null> {
    return this.assignments.currentFor(
      GrowthProspectKind.PROPERTY,
      property.id,
    );
  }
}
