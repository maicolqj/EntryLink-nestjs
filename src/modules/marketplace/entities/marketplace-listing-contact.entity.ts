import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { MarketplaceContactPreference } from '../enums/marketplace-contact-preference.enum';
import { MarketplaceListing } from './marketplace-listing.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * "Me interesa": el rastro de que alguien pidió contacto por una publicación.
 *
 * Sirve para tres cosas distintas, y por eso se guarda en vez de solo disparar
 * la notificación: le dice al publicador quién preguntó aunque haya borrado el
 * aviso, le dice a la administración qué se mueve en la vitrina, y —cuando
 * llegue la reputación de la Fase 2— es lo que permitirá exigir que solo
 * califique quien de verdad contactó.
 *
 * El índice único evita que un mismo interesado infle el contador tocando el
 * botón cinco veces; volver a tocarlo reenvía el aviso, no crea otra fila.
 */
@ObjectType({ description: 'Interés registrado sobre una publicación' })
@Entity({ name: 'marketplace_listing_contacts' })
@Index(['listingId', 'createdAt'])
@Index(['complexId', 'createdAt'])
export class MarketplaceListingContact {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'listing_id', type: 'uuid' })
  listingId: string;

  @Field(() => String)
  @Column({ name: 'interested_user_id', type: 'uuid' })
  interestedUserId: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'interested_unit_id', type: 'uuid', nullable: true })
  interestedUnitId?: string | null;

  /** Canal que se usó. Se copia del aviso al momento del contacto. */
  @Field(() => MarketplaceContactPreference)
  @Column({
    type: 'varchar',
    length: 20,
    default: MarketplaceContactPreference.IN_APP,
  })
  channel: MarketplaceContactPreference;

  @Field(() => String, {
    description: 'Mensaje opcional del interesado',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

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
