import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

import { MaintenanceTagKind } from '../enums/maintenance-tag-kind.enum';
import { MaintenanceCategory } from '../enums/maintenance-category.enum';
import { Building } from '../../residential-complex/entities/building.entity';
import { Amenity } from '../../amenities/entities/amenity.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Punto fijo del conjunto con un QR o un TAG NFC pegado encima: el cuarto de
 * bombas, el ascensor 2 de la torre B, el tablero eléctrico del sótano.
 *
 * Existe porque el GPS del celular no sirve donde más se daña todo. Bajo tierra
 * o entre dos torres, la coordenada llega con cien metros de error o no llega:
 * el reporte queda "en algún lugar del conjunto" y el técnico da vueltas
 * buscando la filtración. Escanear el sticker fija el sitio exacto sin que el
 * residente tenga que describirlo, y de paso convierte la ronda del guarda en
 * un recorrido verificable.
 *
 * El código es lo que va impreso en el sticker. Es único por complejo y no
 * cambia: reimprimir cien stickers porque alguien renombró un punto no es una
 * operación que valga la pena habilitar.
 */
@ObjectType({
  description: 'Punto de ubicación con QR o NFC dentro del complejo',
})
@Entity({ name: 'maintenance_location_tags' })
@Index(['complexId', 'isActive'])
@Index(['complexId', 'code'], { unique: true })
export class MaintenanceLocationTag {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Lo que está impreso en el sticker, ej. "T2-SOT1-BOMBAS". */
  @Field(() => String, { description: 'Código impreso en el sticker' })
  @Column({ type: 'varchar', length: 40 })
  code: string;

  @Field(() => String, { description: 'Nombre visible del punto' })
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Field(() => MaintenanceTagKind)
  @Column({ type: 'varchar', length: 10, default: MaintenanceTagKind.QR })
  kind: MaintenanceTagKind;

  // ─── Dónde queda ──────────────────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ name: 'building_id', type: 'uuid', nullable: true })
  buildingId?: string | null;

  /** Piso o sótano. Negativo para sótanos: -1 es el primer sótano. */
  @Field(() => Int, { nullable: true })
  @Column({ type: 'smallint', nullable: true })
  floor?: number | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'amenity_id', type: 'uuid', nullable: true })
  amenityId?: string | null;

  /**
   * Coordenada del punto, si se levantó en sitio. Se copia al ticket cuando se
   * escanea el tag: es una coordenada medida una vez y con calma, mucho más
   * confiable que la que da el celular del residente en ese momento.
   */
  @Field(() => Float, { nullable: true })
  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  lat?: number | null;

  @Field(() => Float, { nullable: true })
  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  lng?: number | null;

  /** Categoría que se propone al escanear (el cuarto de bombas es PLOMERIA). */
  @Field(() => MaintenanceCategory, { nullable: true })
  @Column({
    name: 'default_category',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  defaultCategory?: MaintenanceCategory | null;

  @Field(() => Boolean)
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // ─── Multi-tenant y auditoría ─────────────────────────────────────────────

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  // ─── Relaciones ───────────────────────────────────────────────────────────

  @Field(() => Building, { nullable: true })
  @ManyToOne(() => Building, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'building_id' })
  building?: Building;

  @Field(() => Amenity, { nullable: true })
  @ManyToOne(() => Amenity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'amenity_id' })
  amenity?: Amenity;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @BeforeInsert()
  @BeforeUpdate()
  normalize(): void {
    // El código viaja en un QR y a veces se teclea a mano: sin normalizar,
    // "t2-sot1" y "T2-SOT1" serían dos puntos distintos y el índice único no
    // atajaría nada.
    this.code = this.code?.trim().toUpperCase();
    this.name = this.name?.trim();
  }
}
