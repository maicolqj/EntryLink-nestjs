import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

import { MaintenanceCategory } from '../enums/maintenance-category.enum';
import { MaintenancePriority } from '../enums/maintenance-priority.enum';
import { MaintenanceTicketStatus } from '../enums/maintenance-ticket-status.enum';
import { MaintenanceLocationType } from '../enums/maintenance-location-type.enum';
import { MaintenanceAssigneeType } from '../enums/maintenance-assignee-type.enum';
import { MaintenanceVisibility } from '../enums/maintenance-visibility.enum';
import { MaintenanceTicketEvent } from './maintenance-ticket-event.entity';
import { MaintenanceLocationTag } from './maintenance-location-tag.entity';
import { MaintenanceVendor } from './maintenance-vendor.entity';
import {
  textArrayTransformer,
  numericTransformer,
} from '../utils/text-array.transformer';

import { Building } from '../../residential-complex/entities/building.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { Amenity } from '../../amenities/entities/amenity.entity';
import { User } from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Reporte de daño en zona común convertido en orden de trabajo.
 *
 * Lo que hoy se pierde entre llamadas, WhatsApp y notas en portería aquí queda
 * con número, sitio, foto sellada, responsable y plazo. Tres decisiones
 * sostienen el resto:
 *
 *   · El relato y la evidencia inicial NO se editan. Es lo que después
 *     justifica un gasto ante el consejo, y un expediente editable no prueba
 *     nada. Lo que cambia con el tiempo vive en la bitácora
 *     (`MaintenanceTicketEvent`), que solo crece.
 *   · La ubicación guarda el MÉTODO junto con el punto. Un GPS de sótano y un
 *     tag pegado en la pared no valen lo mismo, y el mapa no puede pintarlos
 *     igual.
 *   · `RESOLVED` no es `CLOSED`. Quien reparó declara resuelto; quien reportó
 *     confirma. Sin esa separación la calificación no tiene dónde caber y
 *     nadie se entera de que el arreglo quedó mal hecho.
 */
@ObjectType({ description: 'Ticket de mantenimiento en zonas comunes' })
@Entity({ name: 'maintenance_tickets' })
@Index(['complexId', 'status'])
@Index(['complexId', 'consecutive'], { unique: true })
@Index(['complexId', 'category', 'status'])
@Index(['complexId', 'slaDueAt'])
@Index(['assignedUserId'])
@Index(['vendorId'])
@Index(['locationTagId'])
export class MaintenanceTicket {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Número visible, consecutivo por complejo: "MTO-000012". Es lo que se cita
   * en la cotización del proveedor y en el informe al consejo, así que no
   * puede ser el uuid.
   */
  @Field(() => String, { description: 'Número del ticket, consecutivo' })
  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Field(() => Int)
  @Column({ type: 'int' })
  consecutive: number;

  // ==================== QUÉ PASÓ ====================

  @Field(() => String, { description: 'Resumen corto del daño' })
  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Field(() => String)
  @Column({ type: 'text' })
  description: string;

  @Field(() => MaintenanceCategory)
  @Column({ type: 'varchar', length: 30 })
  category: MaintenanceCategory;

  @Field(() => MaintenancePriority)
  @Column({ type: 'varchar', length: 20, default: MaintenancePriority.MEDIUM })
  priority: MaintenancePriority;

  @Field(() => MaintenanceVisibility)
  @Column({
    type: 'varchar',
    length: 10,
    default: MaintenanceVisibility.PUBLIC,
  })
  visibility: MaintenanceVisibility;

  @Field(() => [String], { description: 'Fotos del daño (R2)', nullable: true })
  @Column({
    name: 'photo_urls',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArrayTransformer,
  })
  photoUrls: string[];

  /**
   * SHA-256 de cada foto, en el mismo orden que `photoUrls`. Igual que en los
   * reportes de convivencia: el EXIF del celular se edita, el sello del
   * servidor no. Cuando el proveedor sostenga que el daño ya estaba así, el
   * hash demuestra qué imagen llegó y cuándo.
   */
  @Field(() => [String], { nullable: true })
  @Column({
    name: 'photo_hashes',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArrayTransformer,
  })
  photoHashes: string[];

  @Field(() => String, {
    description: 'Video corto del daño (R2)',
    nullable: true,
  })
  @Column({ name: 'video_url', type: 'text', nullable: true })
  videoUrl?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'video_hash', type: 'varchar', length: 64, nullable: true })
  videoHash?: string | null;

  /**
   * Cuándo se vio el daño, según quien reporta. Aparte de `createdAt` porque
   * no son lo mismo: se reporta de noche lo que se vio en la mañana. Para el
   * SLA cuenta cuándo entró el ticket, no cuándo empezó la gotera.
   */
  @Field(() => Date)
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  // ==================== DÓNDE ====================

  @Field(() => MaintenanceLocationType)
  @Column({
    name: 'location_type',
    type: 'varchar',
    length: 20,
    default: MaintenanceLocationType.TREE,
  })
  locationType: MaintenanceLocationType;

  @Field(() => String, {
    description: 'Referencia escrita del sitio (junto al parqueadero 45)',
    nullable: true,
  })
  @Column({
    name: 'location_text',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  locationText?: string | null;

  @Field(() => Float, { nullable: true })
  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  lat?: number | null;

  @Field(() => Float, { nullable: true })
  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  lng?: number | null;

  /**
   * Error declarado por el dispositivo, en metros.
   *
   * Es el campo que decide si el pin se pinta. Un GPS de sótano entrega
   * coordenadas con cien metros de error y las entrega con la misma cara de
   * seguridad que una buena: pintar ese punto manda al técnico a la torre
   * equivocada, y eso es peor que no pintar nada.
   */
  @Field(() => Int, { nullable: true })
  @Column({ name: 'gps_accuracy_meters', type: 'int', nullable: true })
  gpsAccuracyMeters?: number | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'building_id', type: 'uuid', nullable: true })
  buildingId?: string | null;

  /** Piso o sótano. Negativo para sótanos: -1 es el primer sótano. */
  @Field(() => Int, { nullable: true })
  @Column({ type: 'smallint', nullable: true })
  floor?: number | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'amenity_id', type: 'uuid', nullable: true })
  amenityId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'location_tag_id', type: 'uuid', nullable: true })
  locationTagId?: string | null;

  // ==================== QUIÉN REPORTA ====================

  @Field(() => String, { nullable: true })
  @Column({ name: 'reported_by_user_id', type: 'uuid', nullable: true })
  reportedByUserId?: string | null;

  @Field(() => String, {
    description: 'Rol de quien reportó, congelado al radicar',
    nullable: true,
  })
  @Column({
    name: 'reported_by_role',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  reportedByRole?: string | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'reported_by_name',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  reportedByName?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'reported_by_unit_id', type: 'uuid', nullable: true })
  reportedByUnitId?: string | null;

  /**
   * Cuántos vecinos dijeron "a mí también me pasa".
   *
   * Desnormalizado porque el tablero ordena por esto: contar la tabla de
   * adhesiones en cada consulta del Kanban es un join que no paga.
   */
  @Field(() => Int)
  @Column({ name: 'endorsement_count', type: 'int', default: 0 })
  endorsementCount: number;

  // ==================== TRÁMITE ====================

  @Field(() => MaintenanceTicketStatus)
  @Column({ type: 'varchar', length: 20, default: MaintenanceTicketStatus.NEW })
  status: MaintenanceTicketStatus;

  @Field(() => String, { nullable: true })
  @Column({ name: 'triaged_by_user_id', type: 'uuid', nullable: true })
  triagedByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'triaged_at', type: 'timestamptz', nullable: true })
  triagedAt?: Date | null;

  @Field(() => MaintenanceAssigneeType, { nullable: true })
  @Column({
    name: 'assignee_type',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  assigneeType?: MaintenanceAssigneeType | null;

  @Field(() => String, {
    description: 'Personal interno asignado',
    nullable: true,
  })
  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId?: string | null;

  @Field(() => String, {
    description: 'Proveedor externo asignado',
    nullable: true,
  })
  @Column({ name: 'vendor_id', type: 'uuid', nullable: true })
  vendorId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'assigned_by_user_id', type: 'uuid', nullable: true })
  assignedByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt?: Date | null;

  /** Cuándo se comprometió el técnico a ir. Es lo que se le cuenta al residente. */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'scheduled_for', type: 'timestamptz', nullable: true })
  scheduledFor?: Date | null;

  // ==================== SLA ====================

  /**
   * Horas de SLA congeladas al calcularlas. Cambiar la política mañana no
   * puede mover el plazo de un ticket que ya está corriendo — misma regla que
   * el plazo de descargos de convivencia y que el vencimiento del PQRF.
   */
  @Field(() => Int, { nullable: true })
  @Column({ name: 'sla_hours', type: 'int', nullable: true })
  slaHours?: number | null;

  @Field(() => Date, { description: 'Vencimiento del SLA', nullable: true })
  @Column({ name: 'sla_due_at', type: 'timestamptz', nullable: true })
  slaDueAt?: Date | null;

  /** Se sella una sola vez: el aviso de incumplimiento no se repite cada hora. */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'sla_breached_at', type: 'timestamptz', nullable: true })
  slaBreachedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'on_hold_reason', type: 'text', nullable: true })
  onHoldReason?: string | null;

  // ==================== CIERRE ====================

  @Field(() => String, { nullable: true })
  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes?: string | null;

  @Field(() => [String], {
    description: 'Fotos de la reparación terminada (R2)',
    nullable: true,
  })
  @Column({
    name: 'closure_photo_urls',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArrayTransformer,
  })
  closurePhotoUrls: string[];

  @Field(() => [String], { nullable: true })
  @Column({
    name: 'closure_photo_hashes',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArrayTransformer,
  })
  closurePhotoHashes: string[];

  @Field(() => String, { nullable: true })
  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  /**
   * Lo que costó la reparación. Queda como dato del ticket, no como asiento
   * contable: el gasto lo registra contabilidad por su lado y duplicarlo desde
   * aquí llenaría el estado de resultados de partidas fantasma.
   */
  @Field(() => Float, { nullable: true })
  @Column({
    name: 'actual_cost',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  actualCost?: number | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'closed_by_user_id', type: 'uuid', nullable: true })
  closedByUserId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string | null;

  @Field(() => String, {
    description: 'Ticket original cuando este se marcó como duplicado',
    nullable: true,
  })
  @Column({ name: 'duplicate_of_ticket_id', type: 'uuid', nullable: true })
  duplicateOfTicketId?: string | null;

  // ==================== CALIFICACIÓN ====================

  @Field(() => Int, { description: 'Calificación de 1 a 5', nullable: true })
  @Column({ type: 'smallint', nullable: true })
  rating?: number | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'rating_comment', type: 'text', nullable: true })
  ratingComment?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'rated_at', type: 'timestamptz', nullable: true })
  ratedAt?: Date | null;

  @Field(() => Int)
  @Column({ name: 'reopen_count', type: 'int', default: 0 })
  reopenCount: number;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'last_reopened_at', type: 'timestamptz', nullable: true })
  lastReopenedAt?: Date | null;

  // ==================== MULTI-TENANT Y AUDITORÍA ====================

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  // ==================== RELACIONES ====================

  @Field(() => Building, { nullable: true })
  @ManyToOne(() => Building, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'building_id' })
  building?: Building;

  @Field(() => Amenity, { nullable: true })
  @ManyToOne(() => Amenity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'amenity_id' })
  amenity?: Amenity;

  @Field(() => MaintenanceLocationTag, { nullable: true })
  @ManyToOne(() => MaintenanceLocationTag, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'location_tag_id' })
  locationTag?: MaintenanceLocationTag;

  @Field(() => MaintenanceVendor, { nullable: true })
  @ManyToOne(() => MaintenanceVendor, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vendor_id' })
  vendor?: MaintenanceVendor;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_user_id' })
  assignedUser?: User;

  @Field(() => Unit, { nullable: true })
  @ManyToOne(() => Unit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reported_by_unit_id' })
  reportedByUnit?: Unit;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => [MaintenanceTicketEvent], { nullable: true })
  @OneToMany(() => MaintenanceTicketEvent, (event) => event.ticket)
  events?: MaintenanceTicketEvent[];
}
