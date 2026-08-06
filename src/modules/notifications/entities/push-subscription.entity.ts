import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { PushPlatform } from '../enums/push-platform.enum';

/**
 * Almacena los tokens/endpoints de suscripción push por usuario y plataforma.
 *
 * - WEB:     endpoint + p256dh + auth  (Web Push / VAPID)
 * - ANDROID: deviceToken               (FCM)
 * - IOS:     deviceToken               (FCM via APNs)
 */
@Entity('push_subscriptions')
@Index(['userId', 'platform', 'deviceToken'], {
  unique: true,
  where: '"device_token" IS NOT NULL',
})
@Index(['userId', 'platform', 'endpoint'], {
  unique: true,
  where: '"endpoint" IS NOT NULL',
})
export class PushSubscription {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'complex_id' })
  complexId: string;

  @Column({ name: 'platform', type: 'enum', enum: PushPlatform })
  platform: PushPlatform;

  /** Token de registro FCM (ANDROID / IOS) */
  @Column({ name: 'device_token', nullable: true })
  deviceToken?: string;

  /** Endpoint de Web Push (WEB) */
  @Column({ name: 'endpoint', type: 'text', nullable: true })
  endpoint?: string;

  /** Clave pública p256dh de Web Push (WEB) */
  @Column({ name: 'p256dh', type: 'text', nullable: true })
  p256dh?: string;

  /** Secreto auth de Web Push (WEB) */
  @Column({ name: 'auth', type: 'text', nullable: true })
  auth?: string;

  // ─── Identificación del equipo ─────────────────────────────────────────────
  // Nullable: los equipos ya registrados no la tienen y la llenan al renovar el
  // token. Sirve para cruzar la tasa real de entrega contra el fabricante, que
  // es lo que dice si el problema son ciertas ROMs o es transversal.

  @Column({ name: 'device_model', nullable: true })
  deviceModel?: string;

  @Column({ name: 'manufacturer', nullable: true })
  manufacturer?: string;

  @Column({ name: 'os_version', nullable: true })
  osVersion?: string;

  @Column({ name: 'app_version', nullable: true })
  appVersion?: string;

  /** Último registro/refresco del token: delata equipos que dejaron de reportar. */
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt?: Date;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
