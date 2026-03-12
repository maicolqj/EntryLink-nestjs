import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeeConfig } from './entities/fee-config.entity';
import { FeeCharge } from './entities/fee-charge.entity';
import { Payment }   from './entities/payment.entity';

import { FinanceService }  from './services/finance.service';
import { FinanceResolver } from './resolvers/finance.resolver';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { NotificationsModule }      from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeeConfig, FeeCharge, Payment]),
    ResidentialComplexModule, // ResidentialComplexService + UnitService
    ResidentsModule,          // ResidentsService.findActiveByUnitInternal
    NotificationsModule,      // NotificationsService.create
  ],
  providers: [
    FinanceService,
    FinanceResolver,
  ],
  exports: [
    FinanceService,
  ],
})
export class FinanceModule {}
