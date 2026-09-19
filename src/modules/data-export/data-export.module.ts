import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DataExportService } from './data-export.service';
import { DataExportResolver } from './data-export.resolver';
import { DataExportController } from './data-export.controller';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditModule } from '../audit/audit.module';
import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';

/**
 * Respaldo y reportes: descarga de los datos de cada módulo en Excel, con una
 * hoja de resumen, o de todos en un ZIP. Lee las entidades con el DataSource,
 * así que no depende de los módulos dueños de cada una.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    AuditModule,
    ResidentialComplexModule,
  ],
  providers: [DataExportService, DataExportResolver],
  controllers: [DataExportController],
})
export class DataExportModule {}
