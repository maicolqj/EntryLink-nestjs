import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VotingMeeting } from './entities/voting-meeting.entity';
import { VotingQuestion } from './entities/voting-question.entity';
import { VotingOption } from './entities/voting-option.entity';
import { VotingBallot } from './entities/voting-ballot.entity';
import { VotingService } from './services/voting.service';
import {
  VotingResolver,
  VotingQuestionResolver,
} from './resolvers/voting.resolver';

import { Unit } from '../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule } from '../residents/residents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VotingMeeting,
      VotingQuestion,
      VotingOption,
      VotingBallot,
      Unit, // coeficientes y unidades habilitadas
      ResidentialComplex, // interruptor del módulo
    ]),
    ResidentialComplexModule, // acceso al complejo del usuario
    ResidentsModule, // unidad del residente y miembros del consejo
    NotificationsModule, // aviso de votación abierta
    AuditModule,
  ],
  providers: [VotingService, VotingResolver, VotingQuestionResolver],
  exports: [VotingService],
})
export class VotingModule {}
