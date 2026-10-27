import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionPeriod } from './entities/subscription-period.entity';
import { SubscriptionPlanPrice } from './entities/subscription-plan-price.entity';
import { SubscriptionReminder } from './entities/subscription-reminder.entity';
import { SubscriptionTax } from './entities/subscription-tax.entity';
import { Unit } from '../residential-complex/entities/unit.entity';
import { SubscriptionsService } from './services/subscriptions.service';
import { SubscriptionRemindersService } from './services/subscription-reminders.service';
import { SubscriptionsResolver } from './resolvers/subscriptions.resolver';
import { ComplexSubscriptionFieldsResolver } from './resolvers/complex-subscription-fields.resolver';
import { SubscriptionsCron } from './cron/subscriptions.cron';
import { ComplexReferralsService } from './services/complex-referrals.service';
import { ComplexReferralsResolver } from './resolvers/complex-referrals.resolver';
import { SubscriptionPaymentSubmission } from './entities/subscription-payment-submission.entity';
import { SubscriptionPaymentSettings } from './entities/subscription-payment-settings.entity';
import { SubscriptionPaymentsService } from './services/subscription-payments.service';
import { SubscriptionPaymentsResolver } from './resolvers/subscription-payments.resolver';
import { SubscriptionPaymentsController } from './controllers/subscription-payments.controller';
import { SubscriptionPaymentNotificationDetailProvider } from './providers/subscription-payment-notification-detail.provider';

/**
 * Suscripción de los complejos a la plataforma: periodos mensuales o anuales,
 * prueba gratis, avisos de vencimiento y suspensión del panel administrativo
 * (la aplica SubscriptionGuard desde `@Auth`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionPeriod,
      SubscriptionPlanPrice,
      SubscriptionReminder,
      SubscriptionTax,
      SubscriptionPaymentSubmission,
      SubscriptionPaymentSettings,
      ResidentialComplex,
      Unit,
    ]),
    NotificationsModule,
  ],
  // Renovación con soporte de pago: el conjunto envía el comprobante y el
  // SUPER_ADMIN lo aprueba desde el aviso o desde el panel del conjunto.
  controllers: [SubscriptionPaymentsController],
  providers: [
    SubscriptionsService,
    SubscriptionRemindersService,
    SubscriptionsResolver,
    ComplexSubscriptionFieldsResolver,
    SubscriptionsCron,
    ComplexReferralsService,
    ComplexReferralsResolver,
    SubscriptionPaymentsService,
    SubscriptionPaymentsResolver,
    SubscriptionPaymentNotificationDetailProvider,
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
