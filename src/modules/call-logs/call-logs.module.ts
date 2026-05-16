import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CallLog }           from './entities/call-log.entity';
import { CallLogsService }   from './services/call-logs.service';
import { CallLogsResolver }  from './resolvers/call-logs.resolver';

import { User }                     from '../users/entities/user.entity';
import { Resident }                 from '../residents/entities/resident.entity';
import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { AuditModule }              from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CallLog, User, Resident]),
    ResidentialComplexModule,
    AuditModule,
  ],
  providers: [CallLogsService, CallLogsResolver],
  exports:   [CallLogsService],
})
export class CallLogsModule {}
