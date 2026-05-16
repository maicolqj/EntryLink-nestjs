import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { User } from './user.entity';

export enum AssignmentStatus {
  ACTIVE  = 'ACTIVE',
  REMOVED = 'REMOVED',
}

registerEnumType(AssignmentStatus, {
  name: 'AssignmentStatus',
  description: 'Estado de la asignación de personal a un complejo',
});

/**
 * Registra cada asignación de un usuario de personal (SECURITY, SUPERVISOR, ACCOUNTANT)
 * a un complejo residencial. Permite:
 *  - SECURITY_ROL:           un solo complejo activo a la vez (garantizado por la lógica de servicio)
 *  - SUPERVISOR/ACCOUNTANT:  N complejos simultáneos
 *
 * Los registros NUNCA se borran; se marcan como REMOVED para conservar el historial.
 */
@ObjectType({ description: 'Asignación de personal a un complejo residencial' })
@Entity('user_complex_assignments')
@Index(['userId', 'complexId', 'role', 'status'])
@Index(['userId', 'role', 'status'])
export class UserComplexAssignment {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  /** Nombre del rol: SECURITY_ROL | SUPERVISOR_ROL | ACCOUNTANT_ROL */
  @Field(() => String)
  @Column({ name: 'role', type: 'varchar', length: 50 })
  role: string;

  @Field(() => AssignmentStatus)
  @Column({
    name:    'status',
    type:    'varchar',
    length:  20,
    default: AssignmentStatus.ACTIVE,
  })
  status: AssignmentStatus;

  @Field(() => Date)
  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt?: Date;

  // ── Relaciones ────────────────────────────────────────────────────────────

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
