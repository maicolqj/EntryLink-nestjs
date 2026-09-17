import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { MarketplaceCategory } from '../entities/marketplace-category.entity';
import { MarketplaceListing } from '../entities/marketplace-listing.entity';
import { MarketplaceCategoryKind } from '../enums/marketplace-category-kind.enum';
import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { UpsertMarketplaceCategoryInput } from '../dto/inputs/upsert-marketplace-category.input';
import { DEFAULT_MARKETPLACE_CATEGORIES } from '../constants/default-categories.constant';
import { slugifyCategory } from '../utils/marketplace-module.util';

import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { MarketplaceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

/** Estados en los que un aviso sigue ocupando su categoría. */
const LIVE_STATUSES = [
  MarketplaceListingStatus.DRAFT,
  MarketplaceListingStatus.PENDING_REVIEW,
  MarketplaceListingStatus.PUBLISHED,
  MarketplaceListingStatus.PAUSED,
];

@Injectable()
export class MarketplaceCategoriesService {
  private readonly logger = new Logger(MarketplaceCategoriesService.name);

  constructor(
    @InjectRepository(MarketplaceCategory)
    private readonly categoryRepo: Repository<MarketplaceCategory>,
    @InjectRepository(MarketplaceListing)
    private readonly listingRepo: Repository<MarketplaceListing>,
    private readonly complexService: ResidentialComplexService,
  ) {}

  /**
   * Siembra las categorías que le faltan al complejo.
   *
   * Corre cada vez que alguien entra a la vitrina, no una sola vez: así un
   * conjunto creado antes de que existiera el módulo tampoco se queda con la
   * pantalla vacía. Lo que hace idempotente esto no es un `if` sino el índice
   * único por slug más el `orIgnore()`: dos residentes entrando a la vez
   * intentarían sembrar los dos.
   *
   * Solo agrega lo que falta. Si la administración apagó "Parqueaderos", el
   * sembrado NO la vuelve a encender: la categoría sigue existiendo, apagada,
   * y el slug ya está tomado.
   */
  async ensureDefaults(complexId: string): Promise<void> {
    const rows = DEFAULT_MARKETPLACE_CATEGORIES.map((category) => ({
      complexId,
      kind: category.kind,
      name: category.name,
      slug: category.slug,
      icon: category.icon,
      sortOrder: category.sortOrder,
    }));

    await this.categoryRepo
      .createQueryBuilder()
      .insert()
      .into(MarketplaceCategory)
      .values(rows)
      .orIgnore()
      .execute();
  }

  /**
   * Categorías de la vitrina. El residente solo ve las activas —no tiene
   * sentido ofrecerle publicar en una que la administración cerró—; quien
   * administra las ve todas para poder reactivarlas.
   */
  async findByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
    options: { kind?: MarketplaceCategoryKind; includeInactive?: boolean } = {},
  ): Promise<MarketplaceCategory[]> {
    await this.complexService.assertComplexAccess(complexId, currentUser);
    await this.ensureDefaults(complexId);

    const where: Record<string, unknown> = {
      complexId,
      deletedAt: IsNull(),
      kind: options.kind ?? MarketplaceCategoryKind.CLASSIFIED,
    };

    if (!options.includeInactive) where.isActive = true;

    return this.categoryRepo.find({
      where,
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  /**
   * La categoría en la que se va a publicar. Exige que esté activa: publicar en
   * una categoría cerrada es la forma de saltarse la decisión que la cerró.
   */
  async findPublishable(
    categoryId: string,
    complexId: string,
  ): Promise<MarketplaceCategory> {
    const category = await this.categoryRepo.findOne({
      where: { id: categoryId, complexId, deletedAt: IsNull() },
    });

    if (!category) {
      throw new CustomError({
        message: 'La categoría no existe en este complejo',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MarketplaceErrorCode.MARKETPLACE_CATEGORY_NOT_FOUND,
      });
    }

    if (!category.isActive) {
      throw new CustomError({
        message: `La categoría "${category.name}" está cerrada para publicaciones nuevas`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.MARKETPLACE_CATEGORY_INACTIVE,
      });
    }

    return category;
  }

  async upsert(
    input: UpsertMarketplaceCategoryInput,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceCategory> {
    await this.complexService.assertComplexAccess(input.complexId, currentUser);

    if (input.categoryId) {
      const category = await this.categoryRepo.findOne({
        where: {
          id: input.categoryId,
          complexId: input.complexId,
          deletedAt: IsNull(),
        },
      });

      if (!category) {
        throw new CustomError({
          message: 'La categoría no existe en este complejo',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: MarketplaceErrorCode.MARKETPLACE_CATEGORY_NOT_FOUND,
        });
      }

      // El slug NO se recalcula al renombrar: es lo que el sembrado usa para
      // reconocer lo que ya existe. Corregir una tilde no puede devolver una
      // categoría duplicada a la vitrina.
      Object.assign(category, {
        name: input.name ?? category.name,
        icon: input.icon ?? category.icon,
        sortOrder: input.sortOrder ?? category.sortOrder,
        isActive: input.isActive ?? category.isActive,
      });

      return this.categoryRepo.save(category);
    }

    if (!input.name) {
      throw new CustomError({
        message: 'La categoría necesita un nombre',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.MARKETPLACE_CATEGORY_NOT_FOUND,
      });
    }

    const kind = input.kind ?? MarketplaceCategoryKind.CLASSIFIED;
    const slug = slugifyCategory(input.name);

    const duplicate = await this.categoryRepo.findOne({
      where: { complexId: input.complexId, kind, slug, deletedAt: IsNull() },
    });

    if (duplicate) {
      throw new CustomError({
        message: `Ya existe la categoría "${duplicate.name}" en esta vitrina`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.MARKETPLACE_CATEGORY_DUPLICATE,
      });
    }

    const category = this.categoryRepo.create({
      complexId: input.complexId,
      kind,
      name: input.name,
      slug,
      icon: input.icon,
      sortOrder: input.sortOrder ?? 500,
      isActive: input.isActive ?? true,
      createdByUserId:
        currentUser.entityType === 'user' ? currentUser.sub : null,
    });

    const saved = await this.categoryRepo.save(category);
    this.logger.log(
      `Categoría de clasificados creada: ${saved.name} — complejo ${input.complexId}`,
    );

    return saved;
  }

  /**
   * Retira una categoría de la vitrina.
   *
   * Con avisos vivos dentro no se borra: quedarían apuntando a una categoría
   * que ya no se puede leer, y el residente vería su publicación sin
   * clasificar. Para eso está apagarla —deja de admitir avisos nuevos y los
   * que hay siguen su curso hasta que caduquen—.
   */
  async remove(
    categoryId: string,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const category = await this.categoryRepo.findOne({
      where: { id: categoryId, deletedAt: IsNull() },
    });

    if (!category) {
      throw new CustomError({
        message: 'La categoría no existe',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MarketplaceErrorCode.MARKETPLACE_CATEGORY_NOT_FOUND,
      });
    }

    await this.complexService.assertComplexAccess(
      category.complexId,
      currentUser,
    );

    const inUse = await this.listingRepo.count({
      where: LIVE_STATUSES.map((status) => ({
        categoryId,
        status,
        deletedAt: IsNull(),
      })),
    });

    if (inUse > 0) {
      throw new CustomError({
        message: `La categoría tiene ${inUse} publicación(es) vigente(s). Desactívala en vez de eliminarla`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.MARKETPLACE_CATEGORY_IN_USE,
      });
    }

    category.deletedAt = new Date();
    category.isActive = false;
    await this.categoryRepo.save(category);

    return true;
  }

  /** Uso interno del módulo: no valida permisos. */
  async findByIdInternal(id: string): Promise<MarketplaceCategory | null> {
    return this.categoryRepo.findOne({ where: { id } });
  }
}
