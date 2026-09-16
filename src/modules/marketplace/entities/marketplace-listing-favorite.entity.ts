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

import { MarketplaceListing } from './marketplace-listing.entity';

/**
 * Publicación guardada por un vecino para volver a ella.
 *
 * Es del usuario y de nadie más: el publicador ve el contador
 * (`favoritesCount`) pero nunca la lista de quiénes. Saber que a tres personas
 * les gustó su bicicleta es útil; saber cuáles son, no le corresponde.
 *
 * El favorito sobrevive a la caducidad del aviso a propósito: es la forma de
 * que el interesado le escriba al vecino "¿todavía la tienes?" cuando el aviso
 * ya venció.
 */
@ObjectType({ description: 'Publicación marcada como favorita' })
@Entity({ name: 'marketplace_listing_favorites' })
@Index(['userId', 'createdAt'])
export class MarketplaceListingFavorite {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'listing_id', type: 'uuid' })
  listingId: string;

  @Field(() => String)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => MarketplaceListing, { nullable: true })
  @ManyToOne(() => MarketplaceListing, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing?: MarketplaceListing;
}
