import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SupervisorVisit } from './entities/supervisor-visit.entity';
import { SupervisorAccessRequest } from './entities/supervisor-access-request.entity';
import { SupervisorVisitService } from './services/supervisor-visit.service';
import { SupervisorAccessRequestService } from './services/supervisor-access-request.service';
import { SupervisorVisitResolver } from './resolvers/supervisor-visit.resolver';
import { RevokeInactiveAssignmentsCron } from './cron/revoke-inactive-assignments.cron';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { UserComplexAssignment } from '../users/entities/user-complex-assignment.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupervisorVisit,
      SupervisorAccessRequest,
      ResidentialComplex,
      UserComplexAssignment,
      User,
    ]),
    NotificationsModule,
  ],
  providers: [
    SupervisorVisitService,
    SupervisorAccessRequestService,
    SupervisorVisitResolver,
    RevokeInactiveAssignmentsCron,
  ],
  exports: [SupervisorVisitService, SupervisorAccessRequestService],
})
export class SupervisorVisitsModule {}
