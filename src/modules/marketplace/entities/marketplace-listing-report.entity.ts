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
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { MarketplaceReportReason } from '../enums/marketplace-report-reason.enum';
import { MarketplaceReportStatus } from '../enums/marketplace-report-status.enum';
import { MarketplaceListing } from './marketplace-listing.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Aviso de un vecino sobre una publicación que no debería estar ahí.
 *
 * `reporterUserId` se guarda porque la administración necesita saber quién
 * reportó —para pedir contexto y para detectar al que reporta por deporte— pero
 * NUNCA sale hacia el dueño de la publicación, ni en la ficha ni en el
 * expediente del aviso. Es la misma regla de los reportes de convivencia: el
 * vecino que denuncia vive tres puertas más allá del denunciado.
 *
 * El índice único parcial es lo que impide que una misma persona reporte diez
 * veces el mismo aviso y lo tumbe sola: con el tope por reportes, sin esa
 * restricción bastaría un usuario obstinado para censurar a cualquiera.
 */
@ObjectType({ description: 'Reporte de abuso sobre una publicación' })
@Entity({ name: 'marketplace_listing_reports' })
@Index(['listingId', 'status'])
@Index(['complexId', 'status', 'createdAt'])
export class MarketplaceListingReport {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'listing_id', type: 'uuid' })
  listingId: string;

  @Field(() => MarketplaceReportReason)
  @Column({ type: 'varchar', length: 30 })
  reason: MarketplaceReportReason;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @Field(() => MarketplaceReportStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: MarketplaceReportStatus.PENDING,
  })
  status: MarketplaceReportStatus;

  /**
   * Quién reportó. Solo lo lee la administración: el servicio no lo expone en
   * ninguna consulta que pueda alcanzar el dueño de la publicación.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'reporter_user_id', type: 'uuid', nullable: true })
  reporterUserId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'reporter_unit_id', type: 'uuid', nullable: true })
  reporterUnitId?: string | null;

  // ==================== RESOLUCIÓN ====================

  @Field(() => String, { nullable: true })
  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote?: string | null;

  // ==================== FKs — MULTI-TENANT ====================

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ==================== AUDITORÍA ====================

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ==================== RELACIONES ====================

  @Field(() => MarketplaceListing, { nullable: true })
  @ManyToOne(() => MarketplaceListing, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing?: MarketplaceListing;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;
}
