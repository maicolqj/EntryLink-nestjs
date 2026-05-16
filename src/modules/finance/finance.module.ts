import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ComplexFinanceConfig } from './entities/complex-finance-config.entity';
import { ChargeCategory }       from './entities/charge-category.entity';
import { FeeConfig }            from './entities/fee-config.entity';
import { FeeCharge }            from './entities/fee-charge.entity';
import { Payment }              from './entities/payment.entity';
import { WalletEntry }          from './entities/wallet-entry.entity';
import { ComplexExpense }       from './entities/complex-expense.entity';

import { Vehicle }              from '../vehicles/entities/vehicle.entity';

import { FinanceService }           from './services/finance.service';
import { FinanceResolver }          from './resolvers/finance.resolver';
import { OverdueChargesCron }       from './cron/overdue-charges.cron';
import { AutoGenerateChargesCron }  from './cron/auto-generate-charges.cron';
import { AutoApplyMoraCron }        from './cron/auto-apply-mora.cron';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { NotificationsModule }      from '../notifications/notifications.module';
import { AuditModule }              from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ComplexFinanceConfig,
      ChargeCategory,
      FeeConfig,
      FeeCharge,
      Payment,
      WalletEntry,
      Vehicle,
      ComplexExpense,
    ]),
    ResidentialComplexModule, // ResidentialComplexService + UnitService
    ResidentsModule,          // ResidentsService.findActiveByUnitInternal
    NotificationsModule,      // NotificationsService.create
    AuditModule,
  ],
  providers: [
    FinanceService,
    FinanceResolver,
    OverdueChargesCron,
    AutoGenerateChargesCron,
    AutoApplyMoraCron,
  ],
  exports: [
    FinanceService,
  ],
})
export class FinanceModule {}
