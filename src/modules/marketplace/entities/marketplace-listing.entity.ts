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

import { MarketplaceListingType } from '../enums/marketplace-listing-type.enum';
import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { MarketplacePriceType } from '../enums/marketplace-price-type.enum';
import { MarketplaceItemCondition } from '../enums/marketplace-item-condition.enum';
import { MarketplaceContactPreference } from '../enums/marketplace-contact-preference.enum';
import { MarketplaceCategory } from './marketplace-category.entity';

import {
  textArrayTransformer,
  numericTransformer,
} from '../../maintenance/utils/text-array.transformer';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { User } from '../../users/entities/user.entity';
import { Resident } from '../../residents/entities/resident.entity';

/**
 * Aviso que un vecino publica en la vitrina del conjunto: la nevera que vende,
 * las tortas que hace, el parqueadero que arrienda.
 *
 * Dos decisiones marcan la forma de esta tabla:
 *
 * · **El conjunto no es parte del negocio.** Aquí no hay pagos, ni carrito, ni
 *   inventario. Se publica, se contacta y el trato se cierra afuera. Guardar un
 *   precio y un contador de interesados es todo lo que la copropiedad puede
 *   respaldar sin volverse intermediaria de la transacción.
 *
 * · **Todo aviso caduca.** `expiresAt` no es opcional en la práctica: sin
 *   vigencia, a los tres meses la vitrina es un cementerio de cosas ya vendidas
 *   y nadie vuelve a entrar. El cron avisa antes y el dueño renueva con un
 *   toque.
 *
 * El teléfono del publicador NO vive aquí: sale del usuario y solo si él
 * destapó el canal (`showPhone`) y el complejo permite ese canal. Esa
 * resolución es del servicio, para que el expediente de la notificación herede
 * la misma regla que la pantalla.
 */
@ObjectType({ description: 'Publicación de clasificados del complejo' })
@Entity({ name: 'marketplace_listings' })
@Index(['complexId', 'status', 'publishedAt'])
@Index(['complexId', 'categoryId', 'status'])
@Index(['ownerUserId'])
@Index(['unitId'])
// El cron de caducidad barre por aquí: sin este índice recorre la vitrina
// entera de todos los complejos cada madrugada.
@Index(['status', 'expiresAt'])
export class MarketplaceListing {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== QUÉ SE PUBLICA ====================

  @Field(() => MarketplaceListingType)
  @Column({ type: 'varchar', length: 20 })
  type: MarketplaceListingType;

  @Field(() => String)
  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Field(() => String)
  @Column({ type: 'text' })
  description: string;

  @Field(() => String, { description: 'Categoría de la vitrina' })
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Field(() => MarketplaceItemCondition, {
    description: 'Estado de conservación. Solo aplica a artículos',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 20, nullable: true })
  condition?: MarketplaceItemCondition | null;

  /**
   * Fotos en R2. Es lo que decide si un aviso se mira o se pasa de largo, así
   * que el servicio exige al menos una salvo en `WANTED` —quien busca algo
   * todavía no lo tiene para fotografiarlo—.
   */
  @Field(() => [String])
  @Column({
    name: 'image_urls',
    type: 'text',
    array: true,
    default: () => `'{}'`,
    transformer: textArrayTransformer,
  })
  imageUrls: string[];

  // ==================== PRECIO ====================

  @Field(() => Float, { nullable: true })
  @Column({
    name: 'price_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  priceAmount?: number | null;

  @Field(() => MarketplacePriceType)
  @Column({
    name: 'price_type',
    type: 'varchar',
    length: 20,
    default: MarketplacePriceType.FIXED,
  })
  priceType: MarketplacePriceType;

  @Field(() => String)
  @Column({ type: 'varchar', length: 3, default: 'COP' })
  currency: string;

  // ==================== CONTACTO ====================

  @Field(() => MarketplaceContactPreference)
  @Column({
    name: 'contact_preference',
    type: 'varchar',
    length: 20,
    default: MarketplaceContactPreference.IN_APP,
  })
  contactPreference: MarketplaceContactPreference;

  /**
   * Consentimiento explícito para mostrar el teléfono en la ficha. Nace
   * apagado: publicar algo no es autorizar que el número quede a la vista de
   * trescientas personas (Ley 1581).
   */
  @Field(() => Boolean)
  @Column({ name: 'show_phone', type: 'boolean', default: false })
  showPhone: boolean;

  // ==================== ESTADO Y MODERACIÓN ====================

  @Field(() => MarketplaceListingStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: MarketplaceListingStatus.DRAFT,
  })
  status: MarketplaceListingStatus;

  @Field(() => String, {
    description: 'Motivo del rechazo o del retiro',
    nullable: true,
  })
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'moderated_by_user_id', type: 'uuid', nullable: true })
  moderatedByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'moderated_at', type: 'timestamptz', nullable: true })
  moderatedAt?: Date | null;

  /**
   * Aceptación de las condiciones de uso de la vitrina, con fecha. Es la única
   * prueba de que al publicador se le dijo que la administración no media en la
   * transacción ni responde por ella.
   */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'accepted_terms_at', type: 'timestamptz', nullable: true })
  acceptedTermsAt?: Date | null;

  // ==================== VIGENCIA ====================

  @Field(() => Date, { nullable: true })
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'renewed_at', type: 'timestamptz', nullable: true })
  renewedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'sold_at', type: 'timestamptz', nullable: true })
  soldAt?: Date | null;

  /** Ya se avisó del vencimiento próximo: el cron no repite el aviso a diario. */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'expiry_notified_at', type: 'timestamptz', nullable: true })
  expiryNotifiedAt?: Date | null;

  // ==================== CONTADORES ====================

  @Field(() => Int)
  @Column({ name: 'views_count', type: 'int', default: 0 })
  viewsCount: number;

  @Field(() => Int)
  @Column({ name: 'contacts_count', type: 'int', default: 0 })
  contactsCount: number;

  @Field(() => Int)
  @Column({ name: 'favorites_count', type: 'int', default: 0 })
  favoritesCount: number;

  /**
   * Reportes sin resolver. Al llegar al tope configurado la publicación se
   * pausa sola: entre dejar un presunto fraude a la vista y ocultar algo que
   * quizá era legítimo, lo segundo se deshace con un clic.
   */
  @Field(() => Int)
  @Column({ name: 'pending_reports_count', type: 'int', default: 0 })
  pendingReportsCount: number;

  // ==================== FKs — MULTI-TENANT ====================

  @Field(() => String, { description: 'Usuario que publicó' })
  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'resident_id', type: 'uuid', nullable: true })
  residentId?: string | null;

  @Field(() => String, { description: 'Unidad del publicador' })
  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Field(() => String, { description: 'Complejo (multi-tenant)' })
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;

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

  @Field(() => MarketplaceCategory, { nullable: true })
  @ManyToOne(() => MarketplaceCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category?: MarketplaceCategory;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id' })
  owner?: User;

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

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    if (this.title) this.title = this.title.trim();
    if (this.description) this.description = this.description.trim();
    if (this.currency) this.currency = this.currency.trim().toUpperCase();

    // "Gratis" o "a convenir" con un monto guardado pinta dos precios distintos
    // en la misma tarjeta: manda el tipo de precio.
    if (
      this.priceType === MarketplacePriceType.FREE ||
      this.priceType === MarketplacePriceType.EXCHANGE ||
      this.priceType === MarketplacePriceType.ON_REQUEST
    ) {
      this.priceAmount = null;
    }
  }
}
