import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Pqrf }        from './entities/pqrf.entity';
import { PqrfAcknowledgement } from './entities/pqrf-acknowledgement.entity';
import { PqrfService } from './services/pqrf.service';
import { PqrfResolver } from './resolvers/pqrf.resolver';
import { PqrfCron } from './cron/pqrf.cron';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { NotificationsModule }      from '../notifications/notifications.module';
import { AuditModule }              from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pqrf, PqrfAcknowledgement]),
    ResidentialComplexModule, // acceso al complejo del usuario
    ResidentsModule,          // ficha del residente y miembros del consejo
    NotificationsModule,      // aviso a la instancia destinataria
    AuditModule,
  ],
  providers: [PqrfService, PqrfResolver, PqrfCron],
  exports:   [PqrfService],
})
export class PqrfModule {}
