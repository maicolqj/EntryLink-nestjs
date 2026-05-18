import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Float } from '@nestjs/graphql';

import { AccessRequestStatus } from '../enums/access-request-status.enum';
import { User } from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Solicitud de acceso de un SUPERVISOR_ROL a un complejo residencial.
 *
 * Flujo:
 *  1. Supervisor llega al complejo y no tiene asignación → solicita acceso (PENDING).
 *  2. COMPLEX_ROL recibe la solicitud y aprueba/rechaza remotamente.
 *  3. Si APPROVED → se crea UserComplexAssignment y el supervisor puede hacer check-in.
 *  4. Si REJECTED → el supervisor no tiene acceso.
 *
 * Solo puede existir una solicitud PENDING por supervisor + complejo a la vez.
 * Las solicitudes APPROVED/REJECTED se conservan como historial.
 */
@ObjectType({ description: 'Solicitud de acceso de un supervisor a un complejo residencial' })
@Entity({ name: 'supervisor_access_requests' })
@Index(['supervisorId', 'complexId', 'status'])
@Index(['complexId', 'status'])
export class SupervisorAccessRequest {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== FKs ====================

  @Field(() => String)
  @Column({ name: 'supervisor_id', type: 'uuid' })
  supervisorId: string;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ==================== ESTADO ====================

  @Field(() => AccessRequestStatus)
  @Column({ type: 'enum', enum: AccessRequestStatus, default: AccessRequestStatus.PENDING })
  status: AccessRequestStatus;

  @Field(() => String, { nullable: true, description: 'Mensaje opcional del supervisor al solicitar acceso' })
  @Column({ type: 'text', nullable: true })
  message?: string;

  @Field(() => String, { nullable: true, description: 'Motivo de rechazo (solo cuando status = REJECTED)' })
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  // ==================== UBICACIÓN GPS DE LA SOLICITUD ====================

  @Field(() => Float, { nullable: true, description: 'Latitud GPS del supervisor al solicitar acceso' })
  @Column({ name: 'request_lat', type: 'decimal', precision: 10, scale: 8, nullable: true })
  requestLat?: number;

  @Field(() => Float, { nullable: true, description: 'Longitud GPS del supervisor al solicitar acceso' })
  @Column({ name: 'request_lng', type: 'decimal', precision: 11, scale: 8, nullable: true })
  requestLng?: number;

  // ==================== RESOLUCIÓN ====================

  @Field(() => String, { nullable: true, description: 'ID del usuario que aprobó o rechazó la solicitud' })
  @Column({ name: 'resolved_by_id', type: 'uuid', nullable: true })
  resolvedById?: string;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date;

  // ==================== AUDITORÍA ====================

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // ==================== RELACIONES ====================

  @Field(() => User, { nullable: true, description: 'Supervisor que solicitó el acceso' })
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'supervisor_id' })
  supervisor?: User;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { nullable: true, description: 'Admin que resolvió la solicitud' })
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'resolved_by_id' })
  resolvedBy?: User;
}
