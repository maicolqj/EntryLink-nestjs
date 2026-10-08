import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SecurityAppExit } from './entities/security-app-exit.entity';
import { SecurityAppExitsService } from './services/security-app-exits.service';
import { SecurityAppExitsResolver } from './resolvers/security-app-exits.resolver';
import { SecurityAppExitAlertsCron } from './cron/security-app-exit-alerts.cron';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SecurityAppExit, ResidentialComplex]),
    ResidentialComplexModule, // ResidentialComplexService (acceso al conjunto)
    NotificationsModule,
  ],
  providers: [
    SecurityAppExitsService,
    SecurityAppExitsResolver,
    SecurityAppExitAlertsCron,
  ],
  exports: [SecurityAppExitsService],
})
export class SecurityAppExitsModule {}
