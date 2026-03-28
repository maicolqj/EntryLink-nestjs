import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Visitor }  from './entities/visitor.entity';
import { Visit }    from './entities/visit.entity';

import { VisitorsService }  from './services/visitors.service';
import { VisitsService }    from './services/visits.service';

import { VisitorsResolver } from './resolvers/visitors.resolver';
import { VisitsResolver }   from './resolvers/visits.resolver';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { AuditModule }              from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Visitor, Visit]),
    ResidentialComplexModule, // provee ResidentialComplexService y UnitService
    ResidentsModule,          // provee ResidentsService
    AuditModule,
  ],
  providers: [
    VisitorsService,
    VisitsService,
    VisitorsResolver,
    VisitsResolver,
  ],
  exports: [
    // Exportado para que SecurityModule pueda registrar logs de acceso
    VisitorsService,
    VisitsService,
  ],
})
export class VisitorsModule {}
