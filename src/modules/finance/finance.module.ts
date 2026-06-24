import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ComplexFinanceConfig } from './entities/complex-finance-config.entity';
import { ChargeCategory }       from './entities/charge-category.entity';
import { FeeConfig }            from './entities/fee-config.entity';
import { FeeCharge }            from './entities/fee-charge.entity';
import { Payment }              from './entities/payment.entity';
import { WalletEntry }          from './entities/wallet-entry.entity';
import { ComplexExpense }       from './entities/complex-expense.entity';

// ─── Ledger contable (partida doble) ─────────────────────────────
import { PucAccount }             from './entities/puc-account.entity';
import { AccountingHeader }       from './entities/accounting-header.entity';
import { AccountingLine }         from './entities/accounting-line.entity';
import { PropertyAccountStatus }  from './entities/property-account-status.entity';
import { RecurringCharge }        from './entities/recurring-charge.entity';
import { TenantFinancialConfig }  from './entities/tenant-financial-config.entity';
import { DocumentSequence }       from './entities/document-sequence.entity';

import { Vehicle }              from '../vehicles/entities/vehicle.entity';

import { FinanceService }           from './services/finance.service';
import { FinanceResolver }          from './resolvers/finance.resolver';
import { AccountingService }        from './services/accounting.service';
import { AccountingResolver }       from './resolvers/accounting.resolver';
import { OverdueChargesCron }       from './cron/overdue-charges.cron';
import { AutoGenerateChargesCron }  from './cron/auto-generate-charges.cron';
import { AutoApplyMoraCron }        from './cron/auto-apply-mora.cron';
import { AutoCauseRecurringCron }   from './cron/auto-cause-recurring.cron';

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
      // Ledger contable
      PucAccount,
      AccountingHeader,
      AccountingLine,
      PropertyAccountStatus,
      RecurringCharge,
      TenantFinancialConfig,
      DocumentSequence,
    ]),
    ResidentialComplexModule, // ResidentialComplexService + UnitService
    ResidentsModule,          // ResidentsService.findActiveByUnitInternal
    NotificationsModule,      // NotificationsService.create
    AuditModule,
  ],
  providers: [
    FinanceService,
    FinanceResolver,
    AccountingService,
    AccountingResolver,
    OverdueChargesCron,
    AutoGenerateChargesCron,
    AutoApplyMoraCron,
    AutoCauseRecurringCron,
  ],
  exports: [
    FinanceService,
    AccountingService,
  ],
})
export class FinanceModule {}
