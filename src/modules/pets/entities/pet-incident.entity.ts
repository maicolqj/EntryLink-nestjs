import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

import { PetIncidentType } from '../enums/pet-incident-type.enum';
import { PetIncidentSeverity } from '../enums/pet-incident-severity.enum';
import { PetIncidentStatus } from '../enums/pet-incident-status.enum';
import { Pet } from './pet.entity';
import { PetIncidentStatement } from './pet-incident-statement.entity';

import { Unit } from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/** Transformer compartido con Note: Postgres devuelve el array como texto crudo. */
const textArray = {
  to: (value: string[] | null) => value ?? [],
  from: (value: any): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value as string[];
    if (typeof value === 'string') {
      const stripped = value.replace(/^\{|\}$/g, '');
      if (!stripped) return [];
      return stripped
        .split(',')
        .map((s) => s.replace(/^"|"$/g, '').trim())
        .filter(Boolean);
    }
    return [];
  },
};

/**
 * Reporte de un incumplimiento relacionado con una mascota.
 *
 * El texto y las fotos son INMUTABLES una vez radicado: el reporte es la prueba
 * con la que después se justifica una multa, y un expediente que se puede
 * editar no prueba nada. Lo que cambia con el tiempo es el estado y lo que la
 * administración decide.
 *
 * `petId` es opcional a propósito. Quien ve un perro haciendo daño rara vez
 * sabe de quién es; obligar a señalar mascota haría que el reporte no se
 * radique o que se le cuelgue a la mascota equivocada. La administración
 * atribuye después, y esa atribución queda auditada.
 */
@ObjectType({ description: 'Reporte de convivencia asociado a una mascota' })
@Entity({ name: 'pet_incidents' })
@Index(['complexId', 'status'])
@Index(['complexId', 'consecutive'], { unique: true })
@Index(['petId'])
@Index(['unitId', 'status'])
export class PetIncident {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Número visible del reporte, consecutivo por complejo: "MAS-000012". Es lo
   * que se cita en el llamado de atención y en el estado de cuenta cuando el
   * caso termina en multa, así que no puede ser el uuid.
   */
  @Field(() => String, { description: 'Número del reporte, consecutivo' })
  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Field(() => Int)
  @Column({ type: 'int' })
  consecutive: number;

  // ==================== QUÉ PASÓ ====================

  @Field(() => PetIncidentType)
  @Column({ type: 'varchar', length: 30 })
  type: PetIncidentType;

  @Field(() => PetIncidentSeverity)
  @Column({
    type: 'varchar',
    length: 20,
    default: PetIncidentSeverity.MEDIUM,
  })
  severity: PetIncidentSeverity;

  @Field(() => String, { description: 'Relato de lo ocurrido' })
  @Column({ type: 'text' })
  description: string;

  @Field(() => [String], {
    description: 'Fotos de evidencia (R2)',
    nullable: true,
  })
  @Column({
    name: 'photo_urls',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArray,
  })
  photoUrls: string[];

  /**
   * SHA-256 de cada foto, en el mismo orden que `photoUrls`.
   *
   * El EXIF del celular no sirve como prueba —cualquiera lo edita antes de
   * subir la foto—. Lo que sí vale es que el servidor deje constancia de QUÉ
   * archivo recibió y CUÁNDO: si después alguien discute la evidencia, el hash
   * demuestra que la imagen del expediente es la misma que llegó ese día.
   */
  @Field(() => [String], {
    description: 'SHA-256 de cada foto, en el orden de photoUrls',
    nullable: true,
  })
  @Column({
    name: 'photo_hashes',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArray,
  })
  photoHashes: string[];

  /**
   * Cuándo ocurrió, según quien reporta. Se guarda aparte de `createdAt`
   * porque no son lo mismo: el vecino puede reportar por la noche algo que vio
   * en la mañana, y la hora del hecho es la que importa para la sanción.
   * `createdAt` —hora del servidor— es la que no se puede manipular.
   */
  @Field(() => Date, { description: 'Momento del hecho, según quien reporta' })
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Field(() => String, {
    description: 'Lugar del hecho (pasillo, zona verde, ascensor…)',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 160, nullable: true })
  location?: string;

  @Field(() => Float, { nullable: true })
  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  lat?: number;

  @Field(() => Float, { nullable: true })
  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  lng?: number;

  // ==================== A QUIÉN SE LE ATRIBUYE ====================

  @Field(() => String, {
    description: 'Mascota señalada. Null mientras no se identifique',
    nullable: true,
  })
  @Column({ name: 'pet_id', type: 'uuid', nullable: true })
  petId?: string | null;

  @Field(() => String, {
    description: 'Unidad señalada. Null mientras no se identifique',
    nullable: true,
  })
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId?: string | null;

  // ==================== QUIÉN REPORTA ====================

  /**
   * Se guarda siempre, pero NO se le muestra a la unidad señalada: el módulo
   * existe para resolver un problema de convivencia, no para crear uno nuevo
   * entre vecinos. La administración sí lo ve, y la auditoría también — un
   * reporte anónimo hacia adentro sería una herramienta de acoso.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'reported_by_user_id', type: 'uuid', nullable: true })
  reportedByUserId?: string | null;

  @Field(() => String, {
    description: 'Rol de quien reportó, congelado al radicar',
    nullable: true,
  })
  @Column({
    name: 'reported_by_role',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  reportedByRole?: string | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'reported_by_name',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  reportedByName?: string | null;

  @Field(() => String, {
    description: 'Unidad desde la que se reportó',
    nullable: true,
  })
  @Column({ name: 'reported_by_unit_id', type: 'uuid', nullable: true })
  reportedByUnitId?: string | null;

  // ==================== TRÁMITE ====================

  @Field(() => PetIncidentStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: PetIncidentStatus.REPORTED,
  })
  status: PetIncidentStatus;

  @Field(() => String, { nullable: true })
  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  /**
   * Hasta cuándo puede la unidad presentar descargos. Se congela al validar el
   * reporte con el plazo vigente ese día, por la misma razón que el PQRF: la
   * administración no puede acortarle el plazo a un caso ya abierto.
   */
  @Field(() => Date, {
    description: 'Vencimiento del plazo de descargos',
    nullable: true,
  })
  @Column({ name: 'statement_due_at', type: 'timestamptz', nullable: true })
  statementDueAt?: Date | null;

  @Field(() => String, {
    description: 'Decisión de la administración',
    nullable: true,
  })
  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  // ==================== SANCIÓN ====================

  @Field(() => Float, {
    description: 'Valor de la multa cargada a la unidad',
    nullable: true,
  })
  @Column({
    name: 'fine_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  fineAmount?: number | null;

  /** FeeCharge generado en la cartera de la unidad. Anularlo es cosa de finanzas. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'fine_charge_id', type: 'uuid', nullable: true })
  fineChargeId?: string | null;

  // ==================== MULTI-TENANT Y AUDITORÍA ====================

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  // ==================== RELACIONES ====================

  @Field(() => Pet, { nullable: true })
  @ManyToOne(() => Pet, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'pet_id' })
  pet?: Pet;

  @Field(() => Unit, { nullable: true })
  @ManyToOne(() => Unit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => [PetIncidentStatement], { nullable: true })
  @OneToMany(() => PetIncidentStatement, (statement) => statement.incident)
  statements?: PetIncidentStatement[];
}
