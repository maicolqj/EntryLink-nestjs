import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityEvent } from './activity/entities/activity-event.entity';
import { GrowthActivityResolver } from './activity/resolvers/growth-activity.resolver';
import { ActivityLogService } from './activity/services/activity-log.service';
import { DataSubjectRequest } from './compliance/entities/data-subject-request.entity';
import { LegalHold } from './compliance/entities/legal-hold.entity';
import { Suppression } from './compliance/entities/suppression.entity';
import { SuppressionHash } from './compliance/entities/suppression-hash.entity';
import { GrowthComplianceResolver } from './compliance/resolvers/growth-compliance.resolver';
import { DataSubjectRequestsService } from './compliance/services/data-subject-requests.service';
import { LegalHoldsService } from './compliance/services/legal-holds.service';
import { SuppressionsService } from './compliance/services/suppressions.service';
import { GrowthHashService } from './shared/growth-hash.service';
import { IdentityDirectoryService } from './shared/identity-directory.service';
import { GrowthDataSource } from './sources/entities/growth-data-source.entity';
import { GrowthDataSourcesResolver } from './sources/resolvers/growth-data-sources.resolver';
import { DataSourcesService } from './sources/services/data-sources.service';
import { TeamMember } from './team/entities/team-member.entity';
import { GrowthTeamResolver } from './team/resolvers/growth-team.resolver';
import { TeamMembersService } from './team/services/team-members.service';
import {
  OrganizationChannel,
  PersonChannel,
} from './prospects/entities/channels.entity';
import { Evidence } from './prospects/entities/evidence.entity';
import { GrowthSettings } from './prospects/entities/growth-settings.entity';
import { Organization } from './prospects/entities/organization.entity';
import { Person } from './prospects/entities/person.entity';
import { Property } from './prospects/entities/property.entity';
import { ProspectAssignment } from './prospects/entities/prospect-assignment.entity';
import {
  Employment,
  PropertyManagement,
} from './prospects/entities/relations.entity';
import {
  GrowthEvidenceResolver,
  GrowthProspectOperationsResolver,
} from './prospects/resolvers/prospect-operations.resolver';
import {
  GrowthOrganizationChannelResolver,
  GrowthOrganizationsResolver,
  GrowthPeopleResolver,
  GrowthPersonChannelResolver,
  GrowthPropertiesResolver,
} from './prospects/resolvers/prospect-records.resolver';
import { AssignmentsService } from './prospects/services/assignments.service';
import { ChannelsService } from './prospects/services/channels.service';
import { EvidencesService } from './prospects/services/evidences.service';
import { LegalBasisService } from './prospects/services/legal-basis.service';
import { OrganizationsService } from './prospects/services/organizations.service';
import { PeopleService } from './prospects/services/people.service';
import { PropertiesService } from './prospects/services/properties.service';
import { ProspectDashboardService } from './prospects/services/prospect-dashboard.service';
import { ProspectGuardsService } from './prospects/services/prospect-guards.service';
import { RelationshipsService } from './prospects/services/relationships.service';
import { ValidationService } from './prospects/services/validation.service';
import './prospects/prospects.enums';

/**
 * EntryLink Growth Suite (comercial de Alterna QJ). Se registra SOLO con
 * GROWTH_ENABLED=true (`app.module.ts` + `growth.flag.ts`).
 *
 * Aislamiento: tablas en el esquema `growth`; no importa módulos operativos
 * (regla de ESLint) y ningún módulo operativo la importa. Ver README.md.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeamMember,
      ActivityEvent,
      GrowthDataSource,
      Suppression,
      SuppressionHash,
      DataSubjectRequest,
      LegalHold,
      // EntryLink Prospect (1A)
      Organization,
      Person,
      Property,
      OrganizationChannel,
      PersonChannel,
      Employment,
      PropertyManagement,
      Evidence,
      ProspectAssignment,
      GrowthSettings,
    ]),
  ],
  providers: [
    GrowthHashService,
    IdentityDirectoryService,
    ActivityLogService,
    TeamMembersService,
    DataSourcesService,
    SuppressionsService,
    DataSubjectRequestsService,
    LegalHoldsService,
    GrowthActivityResolver,
    GrowthTeamResolver,
    GrowthDataSourcesResolver,
    GrowthComplianceResolver,
    // EntryLink Prospect (1A)
    ProspectGuardsService,
    EvidencesService,
    ChannelsService,
    OrganizationsService,
    PeopleService,
    PropertiesService,
    RelationshipsService,
    ValidationService,
    AssignmentsService,
    LegalBasisService,
    ProspectDashboardService,
    GrowthOrganizationsResolver,
    GrowthOrganizationChannelResolver,
    GrowthPeopleResolver,
    GrowthPersonChannelResolver,
    GrowthPropertiesResolver,
    GrowthProspectOperationsResolver,
    GrowthEvidenceResolver,
  ],
})
export class GrowthModule {}
