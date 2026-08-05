import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

/**
 * Resultado de la prueba de humo de push, por dispositivo.
 *
 * Existe para poder afirmar algo que hasta ahora se suponía: que el equipo de un
 * guardia efectivamente recibe alertas. Sin esto el fallo solo se descubre
 * durante una emergencia real, que es exactamente cuando no sirve descubrirlo.
 *
 * Los tres flags de permisos los reporta la app; ninguno es consultable desde el
 * servidor. Se guardan para que soporte pueda ver, sin pedirle nada al usuario,
 * qué le falta configurar al equipo.
 */
@ObjectType()
@Entity('device_push_health')
export class DevicePushHealth {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Index({ unique: true })
  @Column({ name: 'push_subscription_id' })
  pushSubscriptionId: string;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'last_test_sent_at', type: 'timestamptz', nullable: true })
  lastTestSentAt?: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'last_test_ack_at', type: 'timestamptz', nullable: true })
  lastTestAckAt?: Date;

  /**
   * Fallos seguidos sin ACK. Se exige más de uno antes de declarar un equipo
   * enfermo: una sola prueba perdida puede ser el ascensor, no el fabricante.
   */
  @Field(() => Int)
  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures: number;

  @Field()
  @Column({ name: 'is_healthy', default: true })
  isHealthy: boolean;

  // ─── Estado reportado por la app (no consultable desde el servidor) ────────

  @Field(() => Boolean, { nullable: true })
  @Column({ name: 'has_battery_optimization_disabled', type: 'boolean', nullable: true })
  hasBatteryOptimizationDisabled?: boolean;

  @Field(() => Boolean, { nullable: true })
  @Column({ name: 'has_full_screen_intent_permission', type: 'boolean', nullable: true })
  hasFullScreenIntentPermission?: boolean;

  @Field(() => Boolean, { nullable: true })
  @Column({ name: 'has_notification_permission', type: 'boolean', nullable: true })
  hasNotificationPermission?: boolean;

  /** Cuándo el usuario superó el wizard con una prueba real exitosa. */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'onboarding_completed_at', type: 'timestamptz', nullable: true })
  onboardingCompletedAt?: Date;

  @Field()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
