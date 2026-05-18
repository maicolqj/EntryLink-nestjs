import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { AuditAction }     from '../enums/audit-action.enum';
import { AuditEntityType } from '../enums/audit-entity-type.enum';

@ObjectType({ description: 'Registro de auditoría de una acción realizada en el sistema' })
@Entity('audit_logs')
@Index(['complexId', 'createdAt'])
@Index(['complexId', 'performedByRole'])
@Index(['entityType', 'entityId'])
@Index(['referenceNumber'], { unique: true })
export class AuditLog {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Identificación ─────────────────────────────────────────────

  @Field(() => String, { description: 'Número de referencia único (AUD-YYYYMMDD-XXXX)' })
  @Column({ name: 'reference_number', type: 'varchar', length: 30, unique: true })
  referenceNumber: string;

  // ── Qué se hizo ────────────────────────────────────────────────

  @Field(() => AuditEntityType, { description: 'Tipo de entidad afectada' })
  @Column({ name: 'entity_type', type: 'varchar', length: 50 })
  entityType: AuditEntityType;

  @Field(() => String, { description: 'ID de la entidad afectada' })
  @Column({ name: 'entity_id', type: 'varchar', length: 100 })
  entityId: string;

  @Field(() => AuditAction, { description: 'Acción realizada' })
  @Column({ type: 'varchar', length: 20 })
  action: AuditAction;

  @Field(() => String, { description: 'Descripción legible de la acción', nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  // ── Estado anterior / nuevo ────────────────────────────────────

  @Field(() => GraphQLJSON, { description: 'Estado de la entidad ANTES de la acción (null en CREATE)', nullable: true })
  @Column({ name: 'previous_value', type: 'jsonb', nullable: true })
  previousValue?: Record<string, any>;

  @Field(() => GraphQLJSON, { description: 'Estado de la entidad DESPUÉS de la acción (null en DELETE)', nullable: true })
  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue?: Record<string, any>;

  // ── Quién lo hizo ──────────────────────────────────────────────

  @Field(() => String, { description: 'ID del usuario o complejo que realizó la acción' })
  @Column({ name: 'performed_by_id', type: 'varchar', length: 100 })
  performedById: string;

  @Field(() => String, { description: 'Nombre para mostrar del actor (email, nombre, etc.)', nullable: true })
  @Column({ name: 'performed_by_name', type: 'varchar', length: 200, nullable: true })
  performedByName?: string;

  @Field(() => String, { description: 'Rol del actor al momento de la acción' })
  @Column({ name: 'performed_by_role', type: 'varchar', length: 50 })
  performedByRole: string;

  // ── Multi-tenant ───────────────────────────────────────────────

  @Field(() => String, { description: 'ID del complejo (para filtrado multi-tenant)', nullable: true })
  @Column({ name: 'complex_id', type: 'uuid', nullable: true })
  complexId?: string;

  // ── Reversión ─────────────────────────────────────────────────

  @Field(() => Boolean, { description: 'Indica si esta acción fue revertida', defaultValue: false })
  @Column({ name: 'is_reverted', type: 'boolean', default: false })
  isReverted: boolean;

  @Field(() => Date, { description: 'Fecha en que fue revertida', nullable: true })
  @Column({ name: 'reverted_at', type: 'timestamptz', nullable: true })
  revertedAt?: Date;

  @Field(() => String, { description: 'ID del usuario que revirtió la acción', nullable: true })
  @Column({ name: 'reverted_by_id', type: 'varchar', length: 100, nullable: true })
  revertedById?: string;

  // ── Auditoría ──────────────────────────────────────────────────

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
