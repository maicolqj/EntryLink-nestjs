import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { ResidentialComplex } from './residential-complex.entity';

/**
 * Tabla de ponderación del coeficiente de copropiedad de un complejo.
 * Una sola fila por complejo (complexId único).
 *
 * Deriva un `score` por unidad con fórmula ADITIVA y los pesos aquí guardados:
 *   score = base × multTipo + Σ (puntos por atributo)
 *     base = área (m²)  ó  1   según `base`
 * El coeficiente de cada unidad = score / Σscore (suma 1). El cálculo y la
 * normalización viven en el frontend; esta entidad solo persiste la config.
 */
@ObjectType({ description: 'Pesos para derivar el coeficiente de copropiedad por características' })
@Entity('coefficient_weightings')
@Index(['complexId'], { unique: true })
export class CoefficientWeighting {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  /** Punto de partida del score: 'AREA' (área m²) o 'UNIT' (1 por unidad). */
  @Field(() => String, { description: "Base del score: 'AREA' | 'UNIT'" })
  @Column({ type: 'varchar', length: 8, default: 'AREA' })
  base: string;

  /** Multiplicador por tipo de unidad. Ej: { "HOUSE": 1, "PENTHOUSE": 1.5 }. */
  @Field(() => GraphQLJSON, { description: 'Multiplicador por tipo de unidad (clave = UnitType)' })
  @Column({ type: 'jsonb', default: {} })
  typeMultipliers: Record<string, number>;

  @Field(() => Float, { description: 'Puntos por alcoba' })
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  perBedroom: number;

  @Field(() => Float, { description: 'Puntos por baño' })
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  perBathroom: number;

  @Field(() => Float, { description: 'Puntos por cada parqueadero' })
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  perParking: number;

  @Field(() => Float, { description: 'Puntos por cada depósito' })
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  perStorage: number;

  @Field(() => Float, { description: 'Puntos si la unidad usa/paga ascensor' })
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  elevatorPoints: number;

  @Field(() => Float, { description: 'Puntos por cada piso de la casa' })
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  houseFloorPoints: number;

  // ─── Relación ─────────────────────────────────────────────────

  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'complexId' })
  complex: ResidentialComplex;

  // ─── Auditoría ────────────────────────────────────────────────

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
