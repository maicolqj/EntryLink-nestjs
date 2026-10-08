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
import { ObjectType, Field, Int } from '@nestjs/graphql';

import { User } from '../../users/entities/user.entity';

/**
 * Cada vez que un vigilante saca EntryLink a segundo plano.
 *
 * La portería no debe salir de la app en todo el turno: mientras está fuera no
 * suena el citófono ni le llega la alerta de pánico. La fila se abre al irse y
 * se cierra al volver; una fila sin `returnedAt` es un vigilante que sigue
 * fuera.
 *
 * El índice único parcial garantiza una sola salida abierta por vigilante, así
 * el reintento de la app (o dos eventos seguidos) no duplica el registro.
 */
@ObjectType({
  description: 'Salida de un vigilante de la app de portería (segundo plano)',
})
@Entity({ name: 'security_app_exits' })
@Index(['complexId', 'leftAt'])
@Index('UQ_security_app_exits_open_guard', ['guardId'], {
  unique: true,
  where: '"returned_at" IS NULL',
})
export class SecurityAppExit {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String)
  @Column({ name: 'guard_id', type: 'uuid' })
  guardId: string;

  @Field(() => Date, { description: 'Cuándo sacó la app a segundo plano' })
  @Column({ name: 'left_at', type: 'timestamptz' })
  leftAt: Date;

  @Field(() => Date, {
    nullable: true,
    description: 'Cuándo volvió a la app. null = sigue fuera',
  })
  @Column({ name: 'returned_at', type: 'timestamptz', nullable: true })
  returnedAt?: Date | null;

  @Field(() => Int, {
    nullable: true,
    description: 'Segundos fuera de la app. null mientras siga fuera',
  })
  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds?: number | null;

  @Field(() => Date, {
    nullable: true,
    description: 'Cuándo se avisó a la administración. null = no se avisó',
  })
  @Column({ name: 'alert_sent_at', type: 'timestamptz', nullable: true })
  alertSentAt?: Date | null;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'guard_id' })
  guard?: User;
}
