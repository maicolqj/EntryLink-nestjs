import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ObjectType, Field, Int } from '@nestjs/graphql';

import { MarketplaceModerationMode } from '../enums/marketplace-moderation-mode.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Reglas con las que cada conjunto opera su vitrina.
 *
 * Va en tabla propia y no como columnas de `residential_complexes` —como quedó
 * mantenimiento— porque son ocho parámetros de un módulo opcional: colgarlos de
 * la tabla del complejo engorda la entidad que carga TODO el sistema en cada
 * consulta de tenencia, para un módulo que muchos conjuntos ni encienden.
 *
 * La fila se crea sola con los valores por defecto la primera vez que alguien
 * entra al módulo. La llave primaria es el complejo: no hay dos filas posibles.
 */
@ObjectType({ description: 'Ajustes del módulo de clasificados del complejo' })
@Entity({ name: 'marketplace_settings' })
export class MarketplaceSettings {
  @Field(() => String)
  @PrimaryColumn({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  /**
   * Nace en `PREVIA`. Ver el comentario del enum: aflojar después es un clic,
   * y lo contrario cuesta una asamblea.
   */
  @Field(() => MarketplaceModerationMode)
  @Column({
    name: 'moderation_mode',
    type: 'varchar',
    length: 10,
    default: MarketplaceModerationMode.PREVIA,
  })
  moderationMode: MarketplaceModerationMode;

  @Field(() => Int, { description: 'Días que dura publicado un aviso' })
  @Column({ name: 'listing_duration_days', type: 'int', default: 30 })
  listingDurationDays: number;

  @Field(() => Int, {
    description: 'Avisos activos que puede tener una unidad',
  })
  @Column({ name: 'max_active_listings_per_unit', type: 'int', default: 5 })
  maxActiveListingsPerUnit: number;

  @Field(() => Int, { description: 'Fotos por publicación' })
  @Column({ name: 'max_images_per_listing', type: 'int', default: 5 })
  maxImagesPerListing: number;

  /**
   * Reportes sin resolver que ocultan el aviso automáticamente. En cero, la
   * pausa automática queda apagada y todo espera a la administración.
   */
  @Field(() => Int, { description: 'Reportes que pausan el aviso solo' })
  @Column({ name: 'auto_pause_after_reports', type: 'int', default: 3 })
  autoPauseAfterReports: number;

  /**
   * Si el conjunto permite que un vecino destape su teléfono en la ficha. Al
   * apagarlo, los avisos que ya lo mostraban dejan de hacerlo: la regla se
   * evalúa al leer, no al publicar.
   */
  @Field(() => Boolean)
  @Column({ name: 'allow_phone_contact', type: 'boolean', default: true })
  allowPhoneContact: boolean;

  /**
   * Si se admiten avisos de "busco / necesito". Encendido por defecto: es la
   * mitad viva de una vitrina vecinal. La administración lo apaga si el tablero
   * se le llena de pedidos.
   */
  @Field(() => Boolean)
  @Column({ name: 'allow_wanted_listings', type: 'boolean', default: true })
  allowWantedListings: boolean;

  /**
   * Condiciones que el vecino acepta al publicar por primera vez. Si está
   * vacío, el servicio usa el texto por defecto de la plataforma —el que deja
   * dicho que la copropiedad no media en la transacción ni responde por ella—.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'terms_text', type: 'text', nullable: true })
  termsText?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;
}
