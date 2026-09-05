import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int } from '@nestjs/graphql';

import { PqrfType }      from '../enums/pqrf-type.enum';
import { PqrfStatus }    from '../enums/pqrf-status.enum';
import { PqrfAddressee } from '../enums/pqrf-addressee.enum';
import { PqrfAcknowledgement } from './pqrf-acknowledgement.entity';

import { Unit }               from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Radicado de un residente hacia la administración, el consejo o ambos.
 *
 * El texto es inmutable: un PQRF es un documento con fecha y número, y dejar que
 * se edite después de radicado le quita el valor que tiene como constancia. Lo
 * que cambia con el tiempo es el estado y —cuando exista— la respuesta.
 *
 * `addressee` no es informativo: decide quién puede leerlo. Una queja dirigida
 * solo al consejo no le aparece a la administración.
 */
@ObjectType({ description: 'Radicado PQRF de un residente' })
@Entity({ name: 'pqrf_requests' })
@Index(['complexId', 'status'])
@Index(['complexId', 'addressee'])
@Index(['residentId'])
export class Pqrf {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Número visible del radicado, consecutivo dentro del complejo: "PQRF-000012".
   * Es lo que el residente cita cuando reclama por su solicitud, así que no
   * puede ser el uuid.
   */
  @Field(() => String, { description: 'Número de radicado, consecutivo por complejo' })
  @Column({ name: 'code', type: 'varchar', length: 20 })
  code: string;

  /** Posición del consecutivo dentro del complejo. Sostiene a `code`. */
  @Field(() => Int)
  @Column({ name: 'consecutive', type: 'int' })
  consecutive: number;

  @Field(() => PqrfType)
  @Column({ name: 'type', type: 'varchar', length: 20 })
  type: PqrfType;

  @Field(() => PqrfAddressee, { description: 'A quién se dirige: define quién puede leerlo' })
  @Column({ name: 'addressee', type: 'varchar', length: 20 })
  addressee: PqrfAddressee;

  @Field(() => PqrfStatus)
  @Column({ name: 'status', type: 'varchar', length: 20, default: PqrfStatus.RADICADO })
  status: PqrfStatus;

  @Field(() => String)
  @Column({ name: 'subject', type: 'varchar', length: 200 })
  subject: string;

  @Field(() => String)
  @Column({ name: 'description', type: 'text' })
  description: string;

  // ─── Quién radica ─────────────────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ name: 'resident_id', type: 'uuid', nullable: true })
  residentId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId?: string | null;

  @Field(() => Unit, { nullable: true })
  @ManyToOne(() => Unit, { eager: false, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @Field(() => String, { nullable: true })
  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId?: string | null;

  /** Nombre congelado al radicar: el residente puede mudarse y el radicado queda. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'requested_by_name', type: 'varchar', length: 200, nullable: true })
  requestedByName?: string | null;

  /**
   * Qué hizo cada destinatario con el radicado. El estado RESUELTO sale de
   * aquí: mientras falte uno por marcarlo, el radicado sigue abierto.
   */
  @Field(() => [PqrfAcknowledgement], { nullable: true })
  @OneToMany(() => PqrfAcknowledgement, ack => ack.pqrf)
  acknowledgements?: PqrfAcknowledgement[];

  /** Cuándo quedó resuelto. Null mientras falte alguna instancia. */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  /**
   * Hasta cuándo tiene el complejo para resolverlo.
   *
   * Se congela al radicar con el plazo vigente ese día: si mañana la
   * administración cambia su configuración, no puede correrle la fecha a un
   * radicado que ya estaba en curso.
   */
  @Field(() => Date)
  @Column({ name: 'due_at', type: 'timestamptz' })
  dueAt: Date;

  /**
   * Se resolvió solo al vencerse el plazo, sin que nadie lo atendiera.
   *
   * Es el silencio administrativo positivo: la ley resuelve a favor de quien
   * radicó. Se marca aparte porque no es lo mismo que una respuesta —el
   * residente tiene que saber cuál de las dos recibió—.
   */
  @Field(() => Boolean, { description: 'Resuelto por silencio administrativo positivo' })
  @Column({ name: 'resolved_by_silence', type: 'boolean', default: false })
  resolvedBySilence: boolean;

  /** Último recordatorio enviado, para no insistir más seguido de lo configurado. */
  @Column({ name: 'last_reminder_at', type: 'timestamptz', nullable: true })
  lastReminderAt?: Date | null;

  // ─── Multi-tenant y auditoría ─────────────────────────────────────────────

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
