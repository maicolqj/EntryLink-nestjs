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
  ],
})
export class GrowthModule {}
