import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field } from '@nestjs/graphql';

import { Pqrf } from './pqrf.entity';
import { PqrfAddressee } from '../enums/pqrf-addressee.enum';

/**
 * Paso de cada destinatario sobre un radicado: cuándo lo abrió y cuándo lo dio
 * por resuelto.
 *
 * Existe una fila por PERSONA y no una marca en el radicado porque un PQRF
 * dirigido a las dos instancias lo atienden varias personas, y darlo por
 * resuelto es responsabilidad de cada una: mientras falte alguien, el radicado
 * sigue abierto. También deja el rastro de quién lo leyó, que es lo que el
 * residente reclama cuando dice que nadie le respondió.
 */
@ObjectType({ description: 'Paso de un destinatario sobre el radicado' })
@Entity({ name: 'pqrf_acknowledgements' })
@Index(['pqrfId', 'userId'], { unique: true })
export class PqrfAcknowledgement {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'pqrf_id', type: 'uuid' })
  pqrfId: string;

  @ManyToOne(() => Pqrf, pqrf => pqrf.acknowledgements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pqrf_id' })
  pqrf?: Pqrf;

  @Field(() => String)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Nombre congelado: quien atendió puede dejar el cargo y el rastro queda. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'user_name', type: 'varchar', length: 200, nullable: true })
  userName?: string | null;

  /** Con qué sombrero lo atendió: administración o consejo. */
  @Field(() => PqrfAddressee)
  @Column({ name: 'instance', type: 'varchar', length: 20 })
  instance: PqrfAddressee;

  @Field(() => Date)
  @CreateDateColumn({ name: 'opened_at', type: 'timestamptz' })
  openedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;
}
