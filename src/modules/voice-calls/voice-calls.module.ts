import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CallLog } from '../call-logs/entities/call-log.entity';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { Resident } from '../residents/entities/resident.entity';
import { User } from '../users/entities/user.entity';
import { PushSubscription } from '../notifications/entities/push-subscription.entity';
import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

import { VoiceCallsService } from './services/voice-calls.service';
import { IceServersService } from './services/ice-servers.service';
import { VoiceCallsResolver } from './resolvers/voice-calls.resolver';
import { VoiceCallsCron } from './cron/voice-calls.cron';

/**
 * Llamadas de voz por internet (WebRTC). Hoy: citofonía portería ↔ residente.
 * Pensado para servir también a las llamadas del chat de clasificados.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CallLog,
      ResidentialComplex,
      Resident,
      User,
      PushSubscription,
    ]),
    ResidentialComplexModule,
    NotificationsModule,
    AuditModule,
  ],
  providers: [
    VoiceCallsService,
    IceServersService,
    VoiceCallsResolver,
    VoiceCallsCron,
  ],
  exports: [VoiceCallsService],
})
export class VoiceCallsModule {}
