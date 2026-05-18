import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { PackageStatus } from '../enums/package-status.enum';
import { PackageType }   from '../enums/package-type.enum';
import { Unit }                   from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex }     from '../../residential-complex/entities/residential-complex.entity';
import { User }                   from '../../users/entities/user.entity';

@ObjectType()
@Entity('packages')
@Index(['complexId', 'status'])
@Index(['complexId', 'unitId'])
@Index(['complexId', 'trackingCode'])
export class Package {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Identificación ───────────────────────────────────────────────

  /** Código de rastreo del remitente (puede ser nulo en sobre sin tracking) */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  trackingCode?: string;

  /** Nombre / empresa del remitente */
  @Field()
  @Column()
  senderName: string;

  /** Descripción breve del contenido */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  description?: string;

  // ─── Clasificación ────────────────────────────────────────────────

  @Field(() => PackageType)
  @Column({ type: 'enum', enum: PackageType, default: PackageType.PARCEL })
  type: PackageType;

  @Field(() => PackageStatus)
  @Column({ type: 'enum', enum: PackageStatus, default: PackageStatus.RECEIVED })
  status: PackageStatus;

  // ─── Fotos ────────────────────────────────────────────────────────

  /** URL de la foto tomada al recibir el paquete */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  photoUrl?: string;

  // ─── Tiempos del ciclo de vida ────────────────────────────────────

  /** Fecha/hora en que se registró la recepción en portería */
  @Field()
  @CreateDateColumn()
  receivedAt: Date;

  /** Fecha/hora en que el residente fue notificado */
  @Field(() => Date, { nullable: true })
  @Column({ nullable: true })
  notifiedAt?: Date;

  /** Fecha/hora en que se confirmó el retiro por el residente */
  @Field(() => Date, { nullable: true })
  @Column({ nullable: true })
  deliveredAt?: Date;

  /** Fecha/hora en que fue devuelto al remitente */
  @Field(() => Date, { nullable: true })
  @Column({ nullable: true })
  returnedAt?: Date;

  /** Número de días máximos de almacenamiento (configurable por complejo) */
  @Field(() => Number, { nullable: true })
  @Column({ nullable: true })
  maxStorageDays?: number;

  // ─── Destinatario ─────────────────────────────────────────────────

  /** Nombre de la persona dentro de la unidad que debe recibir el paquete */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  recipientName?: string;

  // ─── Firma de entrega ─────────────────────────────────────────────

  /** Nombre de quien retiró el paquete (puede diferir del titular de la unidad) */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  receivedByName?: string;

  /** Número de documento de quien retiró el paquete */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  receivedByIdentity?: string;

  // ─── Notas ────────────────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  /** Motivo del retorno o pérdida */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  returnReason?: string;

  // ─── Multi-tenant ─────────────────────────────────────────────────

  @Field()
  @Column()
  complexId: string;

  @Field()
  @Column()
  unitId: string;

  // ─── FK auditoria ─────────────────────────────────────────────────

  /** Usuario (portero/guarda) que registró la recepción. Null cuando lo registra COMPLEX_ROL directamente. */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  registeredByUserId?: string;

  /** Usuario que confirmó la entrega */
  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  deliveredByUserId?: string;

  // ─── Relaciones ───────────────────────────────────────────────────

  @Field(() => Unit)
  @ManyToOne(() => Unit, { eager: false })
  unit: Unit;

  @Field(() => ResidentialComplex)
  @ManyToOne(() => ResidentialComplex, { eager: false })
  complex: ResidentialComplex;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { eager: false, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'registeredByUserId' })
  registeredBy?: User;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { eager: false, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deliveredByUserId' })
  deliveredBy?: User;

  // ─── Auditoría ────────────────────────────────────────────────────

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @DeleteDateColumn()
  deletedAt?: Date;
}
