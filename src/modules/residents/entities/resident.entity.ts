import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
  BeforeUpdate,
  Index,
} from 'typeorm';
import { ObjectType, Field } from '@nestjs/graphql';

import { ResidentType }   from '../enums/resident-type.enum';
import { ResidentStatus } from '../enums/resident-status.enum';
import { User }           from '../../users/entities/user.entity';
import { Unit }           from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

@ObjectType({ description: 'Relación entre un Usuario y una Unidad dentro de un Complejo' })
@Entity({ name: 'residents' })
// Un usuario solo puede ser residente ACTIVO en una unidad por complejo
@Index(['userId', 'complexId', 'status'])
@Index(['unitId', 'status'])
@Index(['complexId', 'status'])
@Index(['approvedByUserId'])
export class Resident {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== TIPO Y ESTADO ====================

  @Field(() => ResidentType, { description: 'Rol del residente respecto a la unidad' })
  @Column({ type: 'enum', enum: ResidentType, default: ResidentType.OWNER })
  type: ResidentType;

  @Field(() => ResidentStatus, { description: 'Estado actual del residente' })
  @Column({ type: 'enum', enum: ResidentStatus, default: ResidentStatus.PENDING_APPROVAL })
  status: ResidentStatus;

  @Field(() => Boolean, { description: 'Es el residente principal de la unidad' })
  @Column({ name: 'is_main_resident', type: 'boolean', default: false })
  isMainResident: boolean;

  // ==================== FECHAS DE RESIDENCIA ====================

  @Field(() => String, { description: 'Fecha de inicio de residencia' })
  @Column({ name: 'start_date', type: 'date' })
  startDate: Date;

  @Field(() => Date, { description: 'Fecha de fin de contrato (para arrendatarios)', nullable: true })
  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate?: Date;

  @Field(() => Date, { description: 'Fecha real de mudanza', nullable: true })
  @Column({ name: 'move_out_date', type: 'date', nullable: true })
  moveOutDate?: Date;

  @Field(() => String, { description: 'Razón de salida', nullable: true })
  @Column({ name: 'move_out_reason', type: 'text', nullable: true })
  moveOutReason?: string;

  // ==================== CONTACTO DE EMERGENCIA ====================

  @Field(() => String, { description: 'Nombre del contacto de emergencia', nullable: true })
  @Column({ name: 'emergency_contact_name', type: 'varchar', length: 200, nullable: true })
  emergencyContactName?: string;

  @Field(() => String, { description: 'Apellido del contacto de emergencia', nullable: true })
  @Column({ name: 'emergency_contact_last_name', type: 'varchar', length: 200, nullable: true })
  emergencyContactLastName?: string;

  @Field(() => String, { description: 'Teléfono del contacto de emergencia', nullable: true })
  @Column({ name: 'emergency_contact_phone', type: 'varchar', length: 20, nullable: true })
  emergencyContactPhone?: string;

  // ==================== APROBACIÓN (COMPLIANCE OFFICER) ====================

  @Field(() => Date, { description: 'Fecha de aprobación', nullable: true })
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt?: Date;

  @Field(() => String, { description: 'Razón de rechazo por el Compliance Officer', nullable: true })
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Field(() => String, { description: 'ID del Compliance Officer que aprobó/rechazó', nullable: true })
  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId?: string;

  // ==================== OBSERVACIONES ====================

  @Field(() => String, { description: 'Notas internas del administrador', nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ==================== MULTI-TENANT (FKs desnormalizadas para performance) ====================

  @Field(() => String, { description: 'ID del usuario residente' })
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => String, { description: 'ID de la unidad asignada' })
  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Field(() => String, { description: 'ID del complejo (desnormalizado para multi-tenant)' })
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ==================== AUDITORÍA ====================

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  // ==================== RELACIONES ====================

  @Field(() => User, { description: 'Usuario residente', nullable: true })
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Field(() => Unit, { description: 'Unidad asignada', nullable: true })
  @ManyToOne(() => Unit, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @Field(() => ResidentialComplex, { description: 'Complejo al que pertenece', nullable: true })
  @ManyToOne(() => ResidentialComplex, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { description: 'Compliance Officer que aprobó/rechazó', nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by_user_id' })
  approvedByUser?: User;

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    if (this.emergencyContactName) {
      this.emergencyContactName = this.emergencyContactName.trim().toUpperCase();
    }
    if (this.emergencyContactLastName) {
      this.emergencyContactLastName = this.emergencyContactLastName.trim().toUpperCase();
    }
    if (this.moveOutReason) {
      this.moveOutReason = this.moveOutReason.trim();
    }
  }
}
