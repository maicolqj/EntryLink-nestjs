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

import { PetSpecies } from '../enums/pet-species.enum';
import { PetSex } from '../enums/pet-sex.enum';
import { PetSize } from '../enums/pet-size.enum';
import { PetStatus } from '../enums/pet-status.enum';

import { Resident } from '../../residents/entities/resident.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Ficha de una mascota que vive en una unidad del complejo.
 *
 * La ficha existe para dos cosas distintas: censar (cuántas mascotas hay y de
 * quién es cada una) e identificar (a qué unidad pertenece el perro que alguien
 * acaba de fotografiar en el pasillo). Por eso la foto y las señas particulares
 * no son opcionales en la práctica: sin ellas un reporte no se puede atribuir.
 */
@ObjectType({ description: 'Mascota registrada por un residente' })
@Entity({ name: 'pets' })
@Index(['complexId', 'status'])
@Index(['unitId', 'status'])
@Index(['residentId'])
// El microchip es único por definición. El índice es parcial porque la mayoría
// de las mascotas no lo tienen, y varios NULL no pueden chocar entre sí.
@Index(['complexId', 'microchipCode'], {
  unique: true,
  where: `"microchip_code" IS NOT NULL AND "deleted_at" IS NULL`,
})
export class Pet {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== IDENTIFICACIÓN ====================

  @Field(() => String, { description: 'Nombre de la mascota' })
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Field(() => PetSpecies, { description: 'Especie' })
  @Column({ type: 'varchar', length: 20 })
  species: PetSpecies;

  @Field(() => String, { description: 'Raza', nullable: true })
  @Column({ type: 'varchar', length: 80, nullable: true })
  breed?: string;

  @Field(() => String, { description: 'Color predominante', nullable: true })
  @Column({ type: 'varchar', length: 60, nullable: true })
  color?: string;

  /**
   * Lo que distingue a ESTA mascota de otra de la misma raza y color: una
   * mancha, una oreja caída, el collar rojo. Es el campo que decide si un
   * reporte se le puede atribuir a una unidad o se queda sin dueño.
   */
  @Field(() => String, {
    description: 'Señas particulares (manchas, collar, cicatrices)',
    nullable: true,
  })
  @Column({ name: 'distinguishing_marks', type: 'text', nullable: true })
  distinguishingMarks?: string;

  @Field(() => PetSex, { description: 'Sexo', nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  sex?: PetSex;

  @Field(() => PetSize, { description: 'Porte', nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  size?: PetSize;

  @Field(() => String, {
    description: 'Fecha de nacimiento (aproximada si no se conoce)',
    nullable: true,
  })
  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate?: Date;

  @Field(() => String, { description: 'URL de la foto (R2)', nullable: true })
  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl?: string;

  // ==================== MICROCHIP ====================

  @Field(() => Boolean, { description: 'Tiene microchip implantado' })
  @Column({ name: 'has_microchip', type: 'boolean', default: false })
  hasMicrochip: boolean;

  @Field(() => String, {
    description: 'Número del microchip',
    nullable: true,
  })
  @Column({
    name: 'microchip_code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  microchipCode?: string;

  // ==================== RAZA DE MANEJO ESPECIAL ====================

  /**
   * Razas catalogadas de manejo especial (Ley 2054 de 2020). No es una etiqueta
   * informativa: obliga a póliza de responsabilidad civil extracontractual
   * vigente y a bozal y traílla en zonas comunes. Sin la póliza, la copropiedad
   * responde por lo que pase.
   */
  @Field(() => Boolean, {
    description: 'Pertenece a una raza de manejo especial',
  })
  @Column({ name: 'is_special_breed', type: 'boolean', default: false })
  isSpecialBreed: boolean;

  @Field(() => String, {
    description: 'Aseguradora de la póliza de RC extracontractual',
    nullable: true,
  })
  @Column({
    name: 'insurance_company',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  insuranceCompany?: string;

  @Field(() => String, {
    description: 'Número de la póliza de RC extracontractual',
    nullable: true,
  })
  @Column({
    name: 'insurance_policy_number',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  insurancePolicyNumber?: string;

  @Field(() => String, {
    description: 'Vencimiento de la póliza',
    nullable: true,
  })
  @Column({ name: 'insurance_expires_at', type: 'date', nullable: true })
  insuranceExpiresAt?: Date;

  // ==================== SANIDAD ====================

  @Field(() => String, {
    description: 'URL del carné de vacunación (R2)',
    nullable: true,
  })
  @Column({ name: 'vaccination_card_url', type: 'text', nullable: true })
  vaccinationCardUrl?: string;

  /** El refuerzo antirrábico es anual: de aquí sale el aviso de vencimiento. */
  @Field(() => String, {
    description: 'Fecha de la última vacuna antirrábica',
    nullable: true,
  })
  @Column({ name: 'rabies_vaccine_at', type: 'date', nullable: true })
  rabiesVaccineAt?: Date;

  @Field(() => Boolean, {
    description: 'Esterilizada',
    nullable: true,
  })
  @Column({ type: 'boolean', nullable: true })
  sterilized?: boolean;

  // ==================== ESTADO Y APROBACIÓN ====================

  @Field(() => PetStatus, { description: 'Estado dentro del complejo' })
  @Column({ type: 'varchar', length: 20, default: PetStatus.PENDING_APPROVAL })
  status: PetStatus;

  @Field(() => Date, { description: 'Fecha de aprobación', nullable: true })
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt?: Date;

  @Field(() => String, {
    description: 'Razón del rechazo o la suspensión',
    nullable: true,
  })
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Field(() => String, {
    description: 'Notas internas de la administración',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ==================== FKs — MULTI-TENANT ====================

  @Field(() => String, {
    description: 'Residente responsable de la mascota',
    nullable: true,
  })
  @Column({ name: 'resident_id', type: 'uuid', nullable: true })
  residentId?: string;

  @Field(() => String, { description: 'Unidad donde vive la mascota' })
  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Field(() => String, { description: 'Complejo (multi-tenant)' })
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string;

  @Field(() => String, {
    description: 'Usuario que aprobó o rechazó la ficha',
    nullable: true,
  })
  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId?: string;

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

  @Field(() => Resident, { nullable: true })
  @ManyToOne(() => Resident, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resident_id' })
  resident?: Resident;

  @Field(() => Unit, { nullable: true })
  @ManyToOne(() => Unit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by_user_id' })
  approvedByUser?: User;

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    if (this.name) this.name = this.name.trim().toUpperCase();
    if (this.breed) this.breed = this.breed.trim().toUpperCase();
    if (this.color) this.color = this.color.trim().toUpperCase();
    if (this.distinguishingMarks) {
      this.distinguishingMarks = this.distinguishingMarks.trim();
    }
    // El microchip se compara contra el índice único: sin normalizar, "982 000"
    // y "982000" serían dos mascotas distintas.
    if (this.microchipCode) {
      this.microchipCode = this.microchipCode.toUpperCase().replace(/\s/g, '');
    }
    if (this.insurancePolicyNumber) {
      this.insurancePolicyNumber = this.insurancePolicyNumber
        .trim()
        .toUpperCase();
    }
    if (this.insuranceCompany) {
      this.insuranceCompany = this.insuranceCompany.trim().toUpperCase();
    }
  }
}
