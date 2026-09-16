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
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import { MarketplaceCategoryKind } from '../enums/marketplace-category-kind.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Categoría bajo la que se ordena una publicación.
 *
 * Es por complejo y no una lista global del sistema, igual que los puntos QR de
 * mantenimiento. La razón no es estética: la administración necesita poder
 * DESACTIVAR una categoría —préstamos de dinero, rifas, licor— sin esperar un
 * despliegue. Una lista global solo se podría filtrar con una tabla de
 * excepciones, que es la misma tabla con más pasos.
 *
 * Las categorías se siembran solas la primera vez que el complejo entra al
 * módulo (`ensureDefaultCategories`), así que nadie empieza con la vitrina
 * vacía.
 */
@ObjectType({ description: 'Categoría de publicaciones del complejo' })
@Entity({ name: 'marketplace_categories' })
@Index(['complexId', 'kind', 'isActive'])
export class MarketplaceCategory {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => MarketplaceCategoryKind)
  @Column({ type: 'varchar', length: 20 })
  kind: MarketplaceCategoryKind;

  @Field(() => String, { description: 'Nombre visible' })
  @Column({ type: 'varchar', length: 80 })
  name: string;

  /**
   * Identificador estable de la categoría dentro del complejo. Se calcula del
   * nombre al crearla y NO se recalcula al renombrarla: es lo que permite que
   * el sembrado reconozca las categorías que ya existen y no las duplique cada
   * vez que alguien corrige una tilde.
   */
  @Field(() => String)
  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Field(() => String, {
    description: 'Ícono sugerido para la web y la app',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 60, nullable: true })
  icon?: string | null;

  @Field(() => Int, { description: 'Orden en la vitrina' })
  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder: number;

  /**
   * Apagada significa "no se puede publicar aquí de ahora en adelante". Lo ya
   * publicado no se cae: retirar cincuenta avisos por un cambio de política es
   * una decisión de la administración, no un efecto secundario de un switch.
   */
  @Field(() => Boolean)
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // ==================== FKs — MULTI-TENANT ====================

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string;

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

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    if (this.name) this.name = this.name.trim();
    if (this.slug) this.slug = this.slug.trim().toLowerCase();
  }
}
