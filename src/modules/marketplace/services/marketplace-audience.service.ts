import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';

import { MarketplaceListingContact } from '../entities/marketplace-listing-contact.entity';
import { MarketplaceListingFavorite } from '../entities/marketplace-listing-favorite.entity';
import { MarketplaceAudienceKind } from '../enums/marketplace-audience-kind.enum';
import { MarketplaceContactPreference } from '../enums/marketplace-contact-preference.enum';
import {
  ListingAudienceEntry,
  PaginatedListingAudienceResponse,
} from '../dto/responses/listing-audience.response';

import { MarketplaceListingsService } from './marketplace-listings.service';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { User } from '../../users/entities/user.entity';
import { Resident } from '../../residents/entities/resident.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';

/** Lo mínimo de cada fila antes de ponerle nombre y unidad. */
interface RawEntry {
  userId: string;
  unitId?: string | null;
  at: Date;
  message?: string | null;
  channel?: MarketplaceContactPreference | null;
}

/**
 * Quién marcó me gusta y a quién le interesa una publicación.
 *
 * Es de la administración: el autor ve los contadores y recibe cada "me
 * interesa", pero la lista de quién guardó su aviso no le corresponde (ver
 * `MarketplaceListingFavorite`).
 *
 * Nombres y unidades se resuelven en dos consultas aparte por página y no con
 * joins: un vecino puede tener varias fichas en el conjunto, y un join las
 * multiplicaría en la paginación.
 */
@Injectable()
export class MarketplaceAudienceService {
  constructor(
    @InjectRepository(MarketplaceListingFavorite)
    private readonly favoriteRepo: Repository<MarketplaceListingFavorite>,
    @InjectRepository(MarketplaceListingContact)
    private readonly contactRepo: Repository<MarketplaceListingContact>,
    private readonly listingsService: MarketplaceListingsService,
    private readonly dataSource: DataSource,
  ) {}

  async findAudience(
    listingId: string,
    kind: MarketplaceAudienceKind,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedListingAudienceResponse> {
    // Valida el acceso al conjunto del aviso.
    const listing = await this.listingsService.findById(listingId, currentUser);

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    let rows: RawEntry[];
    let totalItems: number;

    if (kind === MarketplaceAudienceKind.FAVORITES) {
      const [favorites, total] = await this.favoriteRepo.findAndCount({
        where: { listingId },
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      });
      rows = favorites.map((f) => ({ userId: f.userId, at: f.createdAt }));
      totalItems = total;
    } else {
      const [contacts, total] = await this.contactRepo.findAndCount({
        where: { listingId },
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      });
      rows = contacts.map((c) => ({
        userId: c.interestedUserId,
        unitId: c.interestedUnitId,
        at: c.createdAt,
        message: c.message,
        channel: c.channel,
      }));
      totalItems = total;
    }

    const items = await this.enrich(rows, listing.complexId);
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  private async enrich(
    rows: RawEntry[],
    complexId: string,
  ): Promise<ListingAudienceEntry[]> {
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.map((r) => r.userId))];

    const [users, residents] = await Promise.all([
      this.dataSource.getRepository(User).find({
        where: { id: In(userIds) },
        select: { id: true, name: true, lastName: true, profilePicture: true },
      }),
      this.dataSource.getRepository(Resident).find({
        where: { userId: In(userIds), complexId, deletedAt: IsNull() },
        select: { id: true, userId: true, unitId: true },
      }),
    ]);

    // La unidad guardada en el momento manda; si no hay, la de su ficha actual.
    const unitIds = [
      ...new Set(
        [
          ...rows.map((r) => r.unitId),
          ...residents.map((r) => r.unitId),
        ].filter((id): id is string => !!id),
      ),
    ];
    const units = unitIds.length
      ? await this.dataSource.getRepository(Unit).find({
          where: { id: In(unitIds) },
          relations: ['building'],
        })
      : [];

    const userById = new Map(users.map((u) => [u.id, u]));
    const unitById = new Map(units.map((u) => [u.id, u]));
    const unitOfUser = new Map<string, string>();
    for (const resident of residents) {
      if (!unitOfUser.has(resident.userId)) {
        unitOfUser.set(resident.userId, resident.unitId);
      }
    }

    return rows.map((row) => {
      const user = userById.get(row.userId);
      const unit = unitById.get(row.unitId ?? unitOfUser.get(row.userId) ?? '');
      const name = `${user?.name ?? ''} ${user?.lastName ?? ''}`.trim();

      return {
        userId: row.userId,
        name: name || 'Usuario eliminado',
        profilePicture: user?.profilePicture ?? null,
        unitLabel: unit
          ? [unit.building?.name, unit.number].filter(Boolean).join(' · ')
          : null,
        at: row.at,
        message: row.message ?? null,
        channel: row.channel ?? null,
      };
    });
  }
}
