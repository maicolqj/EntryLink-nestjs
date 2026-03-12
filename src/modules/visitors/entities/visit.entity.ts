import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field } from '@nestjs/graphql';

import { VisitType }   from '../enums/visit-type.enum';
import { VisitStatus } from '../enums/visit-status.enum';
import { Visitor }     from './visitor.entity';
import { Resident }    from '../../residents/entities/resident.entity';
import { Unit }        from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { User }        from '../../users/entities/user.entity';

/**
 * Visit representa UN evento de visita específico.
 * Un Visitor puede tener múltiples Visit.
 */
@ObjectType({ description: 'Evento de visita: entrada, salida, estado y QR de acceso' })
@Entity({ name: 'visits' })
@Index(['complexId', 'status'])
@Index(['complexId', 'entryTime'])
@Index(['unitId', 'status'])
@Index(['qrToken'], { unique: true, where: '"qr_token" IS NOT NULL' })
@Index(['visitorId', 'status'])
export class Visit {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== TIPO Y ESTADO ====================

  @Field(() => VisitType, { description: 'Modalidad de la visita' })
  @Column({ type: 'enum', enum: VisitType, default: VisitType.WALK_IN })
  type: VisitType;

  @Field(() => VisitStatus, { description: 'Estado actual de la visita' })
  @Column({ type: 'enum', enum: VisitStatus, default: VisitStatus.PENDING_APPROVAL })
  status: VisitStatus;

  // ==================== PROPÓSITO ====================

  @Field(() => String, { description: 'Motivo de la visita', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  purpose?: string;

  // ==================== TIEMPOS REALES ====================

  @Field(() => Date, { description: 'Hora de ingreso real', nullable: true })
  @Column({ name: 'entry_time', type: 'timestamptz', nullable: true })
  entryTime?: Date;

  @Field(() => Date, { description: 'Hora de salida real', nullable: true })
  @Column({ name: 'exit_time', type: 'timestamptz', nullable: true })
  exitTime?: Date;

  // ==================== CITA PROGRAMADA ====================

  @Field(() => Date, { description: 'Fecha/hora esperada de llegada (visitas programadas)', nullable: true })
  @Column({ name: 'expected_arrival_at', type: 'timestamptz', nullable: true })
  expectedArrivalAt?: Date;

  @Field(() => Date, { description: 'Fecha/hora límite de llegada', nullable: true })
  @Column({ name: 'expected_arrival_until', type: 'timestamptz', nullable: true })
  expectedArrivalUntil?: Date;

  // ==================== QR CODE ====================

  @Field(() => String, { description: 'Token único del QR de acceso', nullable: true })
  @Column({ name: 'qr_token', type: 'uuid', nullable: true, unique: true })
  qrToken?: string;

  @Field(() => Boolean, { description: 'Indica si el QR ya fue utilizado' })
  @Column({ name: 'qr_used', type: 'boolean', default: false })
  qrUsed: boolean;

  @Field(() => Date, { description: 'Fecha de expiración del QR', nullable: true })
  @Column({ name: 'qr_expires_at', type: 'timestamptz', nullable: true })
  qrExpiresAt?: Date;

  // ==================== VEHÍCULO (OPCIONAL) ====================

  @Field(() => String, { description: 'Placa del vehículo del visitante (si aplica)', nullable: true })
  @Column({ name: 'vehicle_plate', type: 'varchar', length: 10, nullable: true })
  vehiclePlate?: string;

  // ==================== APROBACIÓN DEL RESIDENTE ====================

  @Field(() => Date, { description: 'Momento en que el residente aprobó la visita', nullable: true })
  @Column({ name: 'approved_by_resident_at', type: 'timestamptz', nullable: true })
  approvedByResidentAt?: Date;

  @Field(() => Date, { description: 'Momento en que el residente rechazó la visita', nullable: true })
  @Column({ name: 'denied_by_resident_at', type: 'timestamptz', nullable: true })
  deniedByResidentAt?: Date;

  @Field(() => String, { description: 'Razón del rechazo por parte del residente', nullable: true })
  @Column({ name: 'denial_reason', type: 'varchar', length: 255, nullable: true })
  denialReason?: string;

  // ==================== OBSERVACIONES ====================

  @Field(() => String, { description: 'Notas del guardia de seguridad', nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ==================== FKs (MULTI-TENANT) ====================

  @Field(() => String)
  @Column({ name: 'visitor_id', type: 'uuid' })
  visitorId: string;

  @Field(() => String)
  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { description: 'ID del residente que recibe la visita' })
  @Column({ name: 'host_resident_id', type: 'uuid' })
  hostResidentId: string;

  @Field(() => String, { description: 'ID del guardia que registró la visita' })
  @Column({ name: 'registered_by_user_id', type: 'uuid' })
  registeredByUserId: string;

  @Field(() => String, { description: 'ID del guardia que registró la salida', nullable: true })
  @Column({ name: 'exit_registered_by_user_id', type: 'uuid', nullable: true })
  exitRegisteredByUserId?: string;

  // ==================== AUDITORÍA ====================

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ==================== RELACIONES ====================

  @Field(() => Visitor, { nullable: true })
  @ManyToOne(() => Visitor, (v) => v.visits, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'visitor_id' })
  visitor?: Visitor;

  @Field(() => Unit, { nullable: true })
  @ManyToOne(() => Unit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => Resident, { description: 'Residente anfitrión', nullable: true })
  @ManyToOne(() => Resident, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'host_resident_id' })
  hostResident?: Resident;

  @Field(() => User, { description: 'Guardia que registró la visita', nullable: true })
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'registered_by_user_id' })
  registeredByUser?: User;

  @Field(() => User, { description: 'Guardia que registró la salida', nullable: true })
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'exit_registered_by_user_id' })
  exitRegisteredByUser?: User;
}
