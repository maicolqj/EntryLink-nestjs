import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

import { PanicAlertType }   from '../enums/panic-alert-type.enum';
import { PanicAlertStatus } from '../enums/panic-alert-status.enum';

/**
 * Evento de pánico, como agregado propio.
 *
 * Antes un pánico solo existía como N filas de `notifications` (una por
 * destinatario) correlacionadas por una ventana de ±30s alrededor de createdAt.
 * Esa heurística no distingue dos pánicos simultáneos del mismo complejo:
 * reconocer uno cerraba el otro. Con una entidad propia hay un identificador
 * real que las notificaciones referencian (`notifications.panic_alert_id`), y
 * el estado del incidente deja de vivir repartido entre sus copias.
 *
 * Habilita además lo que la ventana no podía sostener: auditoría de entrega por
 * dispositivo, escalamiento con condición de corte, ubicación y cierre con
 * notas.
 */
@ObjectType()
@Entity('panic_alerts')
@Index(['complexId', 'createdAt'])
// El escalamiento y la vista de portería preguntan siempre por lo que sigue
// abierto en un complejo; sin este índice es un scan por estado.
@Index(['complexId', 'status'])
export class PanicAlert {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Origen ───────────────────────────────────────────────────────────────

  @Field()
  @Column({ name: 'complex_id' })
  complexId: string;

  /** Unidad desde la que se activó. NULL cuando la activa personal o seguridad. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'unit_id', nullable: true })
  unitId?: string;

  /** Residente que la activó. NULL cuando la activa personal o seguridad. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'resident_id', nullable: true })
  residentId?: string;

  @Field()
  @Column({ name: 'triggered_by_user_id' })
  triggeredByUserId: string;

  /**
   * Etiqueta ya compuesta del origen ("Residente – Unidad 302, Torre B").
   * Se desnormaliza a propósito: es lo que ve el guardia en la alerta y debe
   * seguir siendo legible aunque después cambien la unidad o el nombre.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'triggered_by_label', nullable: true })
  triggeredByLabel?: string;

  @Field(() => PanicAlertType)
  @Column({ type: 'enum', enum: PanicAlertType, default: PanicAlertType.PANIC })
  type: PanicAlertType;

  // ─── Ubicación (opcional) ─────────────────────────────────────────────────
  // numeric, no float: en coma flotante binaria una coordenada no vuelve a leerse
  // igual que se guardó, y esto puede terminar en un informe a la policía.

  @Field(() => Float, { nullable: true })
  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  latitude?: number;

  @Field(() => Float, { nullable: true })
  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  longitude?: number;

  /** Precisión reportada por el GPS, en metros. */
  @Field(() => Float, { nullable: true })
  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true })
  accuracy?: number;

  // ─── Estado ───────────────────────────────────────────────────────────────

  @Field(() => PanicAlertStatus)
  @Column({ type: 'enum', enum: PanicAlertStatus, default: PanicAlertStatus.PENDING })
  status: PanicAlertStatus;

  /** Primer dispositivo que confirmó haber mostrado la alerta (automático). */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date;

  @Field(() => String, { nullable: true })
  @Column({ name: 'acknowledged_by_user_id', nullable: true })
  acknowledgedByUserId?: string;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt?: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date;

  @Field(() => String, { nullable: true })
  @Column({ name: 'resolved_by_user_id', nullable: true })
  resolvedByUserId?: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes?: string;

  /**
   * Último nivel de escalamiento ejecutado (0 = solo el envío inicial).
   * Lo lleva el procesador de la cola para no repetir un nivel si el job se
   * reintenta.
   */
  @Field(() => Int)
  @Column({ name: 'escalation_level', type: 'int', default: 0 })
  escalationLevel: number;

  // ─── Auditoría ────────────────────────────────────────────────────────────

  @Field()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
