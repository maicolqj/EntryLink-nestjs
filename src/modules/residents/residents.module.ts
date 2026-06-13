import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { join } from 'path';
import { mkdirSync } from 'fs';

import { Resident }               from './entities/resident.entity';
import { ResidentsService }       from './services/residents.service';
import { ResidentsResolver }      from './resolvers/residents.resolver';
import { ResidentsController }    from './residents.controller';
import { ResidentsImportService } from './services/residents-import.service';
import { ResidentsImportProducer } from './queues/residents-import.producer';
import { ResidentsImportProcessor } from './queues/residents-import.processor';
import { RESIDENTS_IMPORT_QUEUE } from './queues/residents-import.constants';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { AuditModule }              from '../audit/audit.module';
import { NotificationsModule }      from '../notifications/notifications.module';

import { User }     from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user_has_roles.entity';
import { Role }     from '../roles/entities/role.entity';
import { Unit }     from '../residential-complex/entities/unit.entity';
import { Building } from '../residential-complex/entities/building.entity';

// Create temp directory for resident import files
const tmpDir = join(process.cwd(), 'tmp', 'resident-imports');
try { mkdirSync(tmpDir, { recursive: true }); } catch { /* already exists */ }

@Module({
  imports: [
    TypeOrmModule.forFeature([Resident, User, UserRole, Role, Unit, Building]),
    BullModule.registerQueue({ name: RESIDENTS_IMPORT_QUEUE }),
    ResidentialComplexModule,
    AuditModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [ResidentsController],
  providers: [
    ResidentsService,
    ResidentsResolver,
    ResidentsImportService,
    ResidentsImportProducer,
    ResidentsImportProcessor,
  ],
  exports: [
    ResidentsService,
  ],
})
export class ResidentsModule {}
