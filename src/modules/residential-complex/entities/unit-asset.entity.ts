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
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { Unit } from './unit.entity';
import { UnitAssetType } from '../enums/unit-asset-type.enum';

/**
 * Un parqueadero o una bodega que pertenece a una unidad.
 *
 * La unidad ya guarda CUÁNTOS tiene (`parkingSpots`, `storageRooms`); aquí va
 * CUÁLES son, que es lo que el residente necesita saber ("Bodega S1-14, sótano
 * 1"). Un mismo código no puede estar en dos unidades del conjunto.
 */
@ObjectType({ description: 'Parqueadero o bodega propia de una unidad' })
@Entity('unit_assets')
@Index(['unitId'])
@Index(['complexId', 'type', 'code'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class UnitAsset {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => UnitAssetType)
  @Column({ type: 'enum', enum: UnitAssetType, enumName: 'unit_asset_type' })
  type: UnitAssetType;

  @Field({ description: 'Número o código. Ej: "S1-14", "P-203"' })
  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Field(() => String, {
    description: 'Dónde queda. Ej: "Sótano 1, junto al ascensor"',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 150, nullable: true })
  location?: string | null;

  @Field()
  @Column({ name: 'unit_id' })
  unitId: string;

  @Field()
  @Column({ name: 'complex_id' })
  complexId: string;

  @ManyToOne(() => Unit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @Field()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;

  @BeforeInsert()
  @BeforeUpdate()
  normalize() {
    // "s1 - 14" y "S1-14" son la misma bodega: el índice único debe verlo.
    if (this.code) {
      this.code = this.code
        .trim()
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, ' ')
        .toUpperCase();
    }
    if (this.location !== undefined && this.location !== null) {
      this.location = this.location.trim() || null;
    }
  }
}
