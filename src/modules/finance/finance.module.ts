import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join }          from 'path';
import { mkdirSync }     from 'fs';

import { ComplexFinanceConfig } from './entities/complex-finance-config.entity';
import { ChargeCategory }       from './entities/charge-category.entity';
import { FeeConfig }            from './entities/fee-config.entity';
import { FeeCharge }            from './entities/fee-charge.entity';
import { Payment }              from './entities/payment.entity';
import { WalletEntry }          from './entities/wallet-entry.entity';
import { ComplexExpense }       from './entities/complex-expense.entity';
import { DirectIncome }          from './entities/direct-income.entity';
import { ChargeEmission }        from './entities/charge-emission.entity';

// ─── Ledger contable (partida doble) ─────────────────────────────
import { PucAccount }             from './entities/puc-account.entity';
import { AccountingHeader }       from './entities/accounting-header.entity';
import { AccountingLine }         from './entities/accounting-line.entity';
import { PropertyAccountStatus }  from './entities/property-account-status.entity';
import { RecurringCharge }        from './entities/recurring-charge.entity';
import { TenantFinancialConfig }  from './entities/tenant-financial-config.entity';
import { DocumentSequence }       from './entities/document-sequence.entity';

import { Vehicle }              from '../vehicles/entities/vehicle.entity';
import { Unit }                 from '../residential-complex/entities/unit.entity';
import { Building }             from '../residential-complex/entities/building.entity';

import { FinanceService }           from './services/finance.service';
import { FinanceResolver }          from './resolvers/finance.resolver';
import { FinanceController }        from './finance.controller';
import { OpeningBalancesImportService } from './import/opening-balances-import.service';
import { ChargeCalculatorService }  from './services/charge-calculator.service';
import { ChargeEmissionService }    from './services/charge-emission.service';
import { ChargeEmissionResolver }   from './resolvers/charge-emission.resolver';
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

// Directorio temporal para archivos de import de finanzas (saldos de apertura).
const tmpDir = join(process.cwd(), 'tmp', 'finance-imports');
try { mkdirSync(tmpDir, { recursive: true }); } catch { /* ya existe */ }

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
      Unit,
      Building,
      ComplexExpense,
      DirectIncome,
      ChargeEmission,
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
  controllers: [
    FinanceController,
  ],
  providers: [
    FinanceService,
    FinanceResolver,
    OpeningBalancesImportService,
    ChargeCalculatorService,
    ChargeEmissionService,
    ChargeEmissionResolver,
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
