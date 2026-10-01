import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionPeriod } from './entities/subscription-period.entity';
import { SubscriptionPlanPrice } from './entities/subscription-plan-price.entity';
import { SubscriptionReminder } from './entities/subscription-reminder.entity';
import { SubscriptionsService } from './services/subscriptions.service';
import { SubscriptionRemindersService } from './services/subscription-reminders.service';
import { SubscriptionsResolver } from './resolvers/subscriptions.resolver';
import { ComplexSubscriptionFieldsResolver } from './resolvers/complex-subscription-fields.resolver';
import { SubscriptionsCron } from './cron/subscriptions.cron';

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
      ResidentialComplex,
    ]),
    NotificationsModule,
  ],
  providers: [
    SubscriptionsService,
    SubscriptionRemindersService,
    SubscriptionsResolver,
    ComplexSubscriptionFieldsResolver,
    SubscriptionsCron,
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
