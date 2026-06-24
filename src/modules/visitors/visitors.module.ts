import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';

import { Visitor }  from './entities/visitor.entity';
import { Visit }    from './entities/visit.entity';

import { VisitorsService }         from './services/visitors.service';
import { VisitsService }           from './services/visits.service';
import { VisitAccessTokenService } from './services/visit-access-token.service';

import { VisitorsResolver }    from './resolvers/visitors.resolver';
import { VisitsResolver }      from './resolvers/visits.resolver';
import { VisitorsController }  from './controllers/visitors.controller';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { AuditModule }              from '../audit/audit.module';
import { NotificationsModule }      from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Visitor, Visit]),
    ConfigModule,
    JwtModule.register({}),   // sin secret fijo; cada firma usa JWT_ACCESS_SECRET
    ResidentialComplexModule, // provee ResidentialComplexService y UnitService
    ResidentsModule,          // provee ResidentsService
    AuditModule,
    NotificationsModule,      // provee NotificationsService
  ],
  controllers: [VisitorsController],
  providers: [
    VisitorsService,
    VisitsService,
    VisitAccessTokenService,
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
