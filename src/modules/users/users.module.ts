import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'path';
import { mkdirSync } from 'fs';

import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { UsersController } from './users.controller';
import { ExcelImportService } from './services/excel-import.service';
import { ExcelImportProducer } from './queues/excel-import.producer';
import { ExcelImportProcessor } from './queues/excel-import.processor';
import { EXCEL_IMPORT_QUEUE } from './queues/excel-import.constants';

import { User } from './entities/user.entity';
import { UserRole } from './entities/user_has_roles.entity';
import { UserComplexAssignment } from './entities/user-complex-assignment.entity';
import { Role } from '../roles/entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { Unit } from '../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { Resident } from '../residents/entities/resident.entity';
import { RolesService } from '../roles/roles.service';
import { AuditModule }  from '../audit/audit.module';

// Crear directorio temporal si no existe
const tmpDir = join(process.cwd(), 'tmp', 'excel-imports');
try { mkdirSync(tmpDir, { recursive: true }); } catch { /* ya existe */ }

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserRole, UserComplexAssignment, Role, Permission, Unit, Resident, ResidentialComplex]),
    BullModule.registerQueue({ name: EXCEL_IMPORT_QUEUE }),
    MulterModule.register({ dest: tmpDir }),
    AuditModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersResolver,
    UsersService,
    RolesService,
    ExcelImportService,
    ExcelImportProducer,
    ExcelImportProcessor,
  ],
  exports: [UsersService],
})
export class UsersModule {}
