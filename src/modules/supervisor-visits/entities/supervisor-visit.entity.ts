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
import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

import { SupervisorVisitStatus } from '../enums/supervisor-visit-status.enum';
import { User } from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

@ObjectType({ description: 'Registro de visita de supervisor a un complejo residencial' })
@Entity({ name: 'supervisor_visits' })
@Index(['supervisorId', 'status'])
@Index(['complexId', 'status'])
@Index(['supervisorId', 'complexId', 'status'])
export class SupervisorVisit {

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

  // ==================== CHECK-IN ====================

  @Field(() => Date, { description: 'Fecha y hora de check-in' })
  @Column({ name: 'check_in_at', type: 'timestamptz' })
  checkInAt: Date;

  @Field(() => Float, { description: 'Latitud GPS al momento del check-in' })
  @Column({ name: 'check_in_lat', type: 'decimal', precision: 10, scale: 8 })
  checkInLat: number;

  @Field(() => Float, { description: 'Longitud GPS al momento del check-in' })
  @Column({ name: 'check_in_lng', type: 'decimal', precision: 11, scale: 8 })
  checkInLng: number;

  // ==================== CHECK-OUT ====================

  @Field(() => Date, { nullable: true, description: 'Fecha y hora de check-out (null si visita activa)' })
  @Column({ name: 'check_out_at', type: 'timestamptz', nullable: true })
  checkOutAt?: Date;

  // ==================== ESTADO ====================

  @Field(() => SupervisorVisitStatus, { description: 'Estado de la visita: ACTIVE o CLOSED' })
  @Column({ type: 'enum', enum: SupervisorVisitStatus, default: SupervisorVisitStatus.ACTIVE })
  status: SupervisorVisitStatus;

  // ==================== AUDITORÍA ====================

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ==================== RELACIONES ====================

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'supervisor_id' })
  supervisor?: User;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;
}
