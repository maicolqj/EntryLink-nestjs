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
import { BullModule } from '@nestjs/bullmq';
import {
  DuplicateCandidate,
  MergeLog,
  ProspectScore,
  ScoringRule,
} from './prospects/entities/dedupe-scoring.entity';
import { GrowthDedupeScoringResolver } from './prospects/resolvers/prospect-dedupe-scoring.resolver';
import { DedupeService } from './prospects/services/dedupe.service';
import { MergeService } from './prospects/services/merge.service';
import {
  GROWTH_PROSPECTS_QUEUE,
  ProspectEventsService,
} from './prospects/services/prospect-events.service';
import { ProspectJobsProcessor } from './prospects/services/prospect-jobs.processor';
import { ScoringService } from './prospects/services/scoring.service';
import { ScoringSimulationService } from './prospects/services/scoring-simulation.service';
import { ScoringVersionsService } from './prospects/services/scoring-versions.service';
import {
  ProspectScoreHistory,
  ScoringVersion,
} from './prospects/entities/scoring-version.entity';
import { ScoringCatchupService } from './prospects/services/scoring-catchup.service';
import { GrowthScoringVersionsResolver } from './prospects/resolvers/prospect-scoring-versions.resolver';
import { TeamWorkloadService } from './prospects/services/team-workload.service';
import './prospects/prospects.enums';
import { GrowthImportsController } from './imports/controllers/growth-imports.controller';
import {
  ImportBatch,
  ImportMappingTemplate,
  ImportRow,
} from './imports/entities/import.entities';
import './imports/imports.enums';
import {
  GrowthImportRowResolver,
  GrowthImportsResolver,
} from './imports/resolvers/growth-imports.resolver';
import { ImportCommitService } from './imports/services/import-commit.service';
import { ImportJobsProcessor } from './imports/services/import-jobs.processor';
import { ImportPurgeService } from './imports/services/import-purge.service';
import { ImportRedactionService } from './imports/services/import-redaction.service';
import {
  GROWTH_IMPORTS_QUEUE,
  ImportQueueService,
} from './imports/services/import-queue.service';
import { ImportValidationService } from './imports/services/import-validation.service';
import { ImportsService } from './imports/services/imports.service';

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
      // Entrega 1B
      DuplicateCandidate,
      MergeLog,
      ScoringRule,
      ProspectScore,
      // Entrega 1C
      ImportBatch,
      ImportRow,
      ImportMappingTemplate,
      // Entrega 1E-C-0
      ScoringVersion,
      ProspectScoreHistory,
    ]),
    // Cola propia de la suite (Redis existente): duplicados y scoring.
    BullModule.registerQueue({ name: GROWTH_PROSPECTS_QUEUE }),
    BullModule.registerQueue({ name: GROWTH_IMPORTS_QUEUE }),
  ],
  controllers: [GrowthImportsController],
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
    // Entrega 1B
    ProspectEventsService,
    ScoringService,
    DedupeService,
    MergeService,
    ProspectJobsProcessor,
    GrowthDedupeScoringResolver,
    // Entrega 1C
    ImportQueueService,
    ImportRedactionService,
    ImportsService,
    ImportValidationService,
    ImportCommitService,
    ImportJobsProcessor,
    ImportPurgeService,
    GrowthImportsResolver,
    GrowthImportRowResolver,
    // Entrega 1E-0
    ScoringSimulationService,
    TeamWorkloadService,
    // Entrega 1E-C-0
    ScoringVersionsService,
    ScoringCatchupService,
    GrowthScoringVersionsResolver,
  ],
})
export class GrowthModule {}
