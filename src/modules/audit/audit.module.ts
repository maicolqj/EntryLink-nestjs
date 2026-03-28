import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLog }      from './entities/audit-log.entity';
import { AuditService }  from './services/audit.service';
import { AuditResolver } from './resolvers/audit.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
  ],
  providers: [AuditService, AuditResolver],
  exports:   [AuditService],   // exportado para que otros módulos puedan inyectarlo
})
export class AuditModule {}
