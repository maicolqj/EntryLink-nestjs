import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Datos de pago de la plataforma: el QR que escanean los conjuntos y el texto
 * con la cuenta. Una sola fila (`id = 1`) que edita el SUPER_ADMIN.
 *
 * El QR sí va con URL pública: es lo que se muestra a todos los conjuntos y no
 * revela nada que no diga ya la cuenta.
 */
@Entity('subscription_payment_settings')
export class SubscriptionPaymentSettings {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({
    name: 'qr_image_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  qrImageUrl?: string | null;

  @Column({ type: 'text', nullable: true })
  instructions?: string | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

export const PAYMENT_SETTINGS_ID = 1;
