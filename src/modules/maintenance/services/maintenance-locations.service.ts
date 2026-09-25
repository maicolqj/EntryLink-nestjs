import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { MaintenanceLocationTag } from '../entities/maintenance-location-tag.entity';
import { MaintenanceLocationType } from '../enums/maintenance-location-type.enum';
import {
  CreateMaintenanceLocationTagInput,
  UpdateMaintenanceLocationTagInput,
} from '../dto/inputs/maintenance-location-tag.inputs';

import { CustomError } from '../../shared/utils/errors.utils';
import { MaintenanceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { calculateHaversineDistance } from '../../shared/utils/gps.utils';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { BuildingService } from '../../residential-complex/services/building.service';
import { AmenitiesService } from '../../amenities/services/amenities.service';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import {
  MaintenanceReportOptionsResponse,
  MaintenanceScanMethodsResponse,
} from '../dto/responses/maintenance-report-options.response';
import { isMaintenanceModuleEnabled } from '../utils/maintenance-status.util';

/** Lo que quien reporta manda sobre el sitio, antes de validarse. */
export interface RawLocationInput {
  locationType: MaintenanceLocationType;
  locationText?: string | null;
  lat?: number | null;
  lng?: number | null;
  gpsAccuracyMeters?: number | null;
  buildingId?: string | null;
  floor?: number | null;
  amenityId?: string | null;
  locationTagCode?: string | null;
}

/** Lo que queda guardado en el ticket, ya verificado contra el complejo. */
export interface ResolvedLocation {
  locationType: MaintenanceLocationType;
  locationText: string | null;
  lat: number | null;
  lng: number | null;
  gpsAccuracyMeters: number | null;
  buildingId: string | null;
  floor: number | null;
  amenityId: string | null;
  locationTagId: string | null;
}

/**
 * Puntos fijos del conjunto y traducción de lo que manda la app a una
 * ubicación verificada.
 *
 * La verificación importa tanto como el dato: sin ella, cualquiera radica un
 * daño apuntando a la torre de otro complejo, y el mapa de la administración
 * pinta pines que no existen.
 */
@Injectable()
export class MaintenanceLocationsService {
  constructor(
    @InjectRepository(MaintenanceLocationTag)
    private readonly tagRepo: Repository<MaintenanceLocationTag>,
    private readonly complexService: ResidentialComplexService,
    private readonly buildingService: BuildingService,
    private readonly amenitiesService: AmenitiesService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // PUNTOS QR / NFC
  // ═══════════════════════════════════════════════════════════════════════════

  async createTag(
    input: CreateMaintenanceLocationTagInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceLocationTag> {
    await this.complexService.findById(input.complexId, currentUser);

    const code = input.code.trim().toUpperCase();
    const existing = await this.tagRepo.findOne({
      where: { complexId: input.complexId, code, deletedAt: IsNull() },
    });

    if (existing) {
      throw new CustomError({
        message: `Ya existe un punto con el código ${code}: ${existing.name}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TAG_DUPLICATE,
      });
    }

    if (input.buildingId) {
      await this.assertBuildingBelongs(
        input.buildingId,
        input.complexId,
        currentUser,
      );
    }
    if (input.amenityId) {
      await this.assertAmenityBelongs(input.amenityId, input.complexId);
    }

    return this.tagRepo.save(
      this.tagRepo.create({
        ...input,
        code,
        createdByUserId:
          currentUser.entityType === 'user' ? currentUser.sub : null,
      }),
    );
  }

  async updateTag(
    input: UpdateMaintenanceLocationTagInput,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceLocationTag> {
    const tag = await this.findTagByIdOrFail(input.id);
    await this.complexService.findById(tag.complexId, currentUser);

    if (input.buildingId) {
      await this.assertBuildingBelongs(
        input.buildingId,
        tag.complexId,
        currentUser,
      );
    }
    if (input.amenityId) {
      await this.assertAmenityBelongs(input.amenityId, tag.complexId);
    }

    Object.assign(tag, { ...input, id: tag.id });

    return this.tagRepo.save(tag);
  }

  /**
   * Baja lógica del punto. Los tickets viejos lo siguen citando: el sticker se
   * despegó, pero la filtración del cuarto de bombas sigue habiendo ocurrido
   * ahí.
   */
  async deactivateTag(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceLocationTag> {
    const tag = await this.findTagByIdOrFail(id);
    await this.complexService.findById(tag.complexId, currentUser);

    tag.isActive = false;
    tag.deletedAt = new Date();

    return this.tagRepo.save(tag);
  }

  async findTagsByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
    onlyActive = true,
  ): Promise<MaintenanceLocationTag[]> {
    await this.complexService.assertComplexAccess(complexId, currentUser);

    return this.tagRepo.find({
      where: onlyActive
        ? { complexId, isActive: true, deletedAt: IsNull() }
        : { complexId, deletedAt: IsNull() },
      relations: ['building', 'amenity'],
      order: { name: 'ASC' },
    });
  }

  /**
   * Torres, zonas comunes y puntos señalizados, en un solo viaje.
   *
   * Es lo que la app pide al abrir el formulario. Va junto porque quien reporta
   * está de pie frente al daño —muchas veces en un sótano con una raya de
   * señal—, y tres consultas ahí son tres formas de que la pantalla no cargue.
   */
  async findReportOptions(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceReportOptionsResponse> {
    const complex = await this.complexService.findById(complexId, currentUser);

    if (!isMaintenanceModuleEnabled(complex)) {
      throw new CustomError({
        message:
          'El módulo de mantenimiento no está habilitado en este complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: MaintenanceErrorCode.MAINTENANCE_MODULE_DISABLED,
      });
    }

    const [buildings, amenities, tags] = await Promise.all([
      this.buildingService.findByComplex(
        complexId,
        { page: 1, limit: 100 },
        currentUser,
      ),
      this.amenitiesService.findByComplex(
        complexId,
        { page: 1, limit: 100 },
        {},
        currentUser,
      ),
      this.tagRepo.find({
        where: { complexId, isActive: true, deletedAt: IsNull() },
        relations: ['building', 'amenity'],
        order: { name: 'ASC' },
      }),
    ]);

    return {
      buildings: buildings.items,
      amenities: amenities.items,
      tags,
      residentReportingEnabled: complex.maintenanceResidentReportingEnabled,
      gpsAccuracyMeters: complex.maintenanceGpsAccuracyMeters ?? 100,
      qrEnabled: complex.maintenanceQrEnabled ?? true,
      nfcEnabled: complex.maintenanceNfcEnabled ?? false,
    };
  }

  /**
   * Qué botones ofrecen las apps para identificar el sitio: escanear el QR,
   * leer el chip NFC o ambos. Lo decide la administración según lo que pegó en
   * las paredes. Apagar los dos deja solo el código escrito a mano, que sigue
   * funcionando siempre.
   */
  async setScanMethods(
    complexId: string,
    qrEnabled: boolean,
    nfcEnabled: boolean,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceScanMethodsResponse> {
    await this.complexService.findById(complexId, currentUser);
    await this.tagRepo.manager.update(ResidentialComplex, complexId, {
      maintenanceQrEnabled: qrEnabled,
      maintenanceNfcEnabled: nfcEnabled,
    });
    return { qrEnabled, nfcEnabled };
  }

  /**
   * Lo que resuelve el escaneo del QR antes de abrir el formulario: la app
   * muestra "Cuarto de bombas · Torre 2 · Sótano 1" y precarga la categoría.
   */
  async findTagByCode(
    complexId: string,
    code: string,
    currentUser: JwtAccessPayload,
  ): Promise<MaintenanceLocationTag> {
    await this.complexService.assertComplexAccess(complexId, currentUser);

    return this.resolveTagByCode(complexId, code);
  }

  async findTagByIdOrFail(id: string): Promise<MaintenanceLocationTag> {
    const tag = await this.tagRepo.findOne({ where: { id } });

    if (!tag) {
      throw new CustomError({
        message: `Punto de ubicación con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TAG_NOT_FOUND,
      });
    }

    return tag;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLUCIÓN DE LA UBICACIÓN DE UN TICKET
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Convierte lo que mandó la app en una ubicación verificada contra este
   * complejo. Cada método exige lo suyo: un ticket con `locationType = TAG` y
   * sin tag no es un ticket ubicado, es un ticket que miente sobre estarlo.
   */
  async resolveLocation(
    raw: RawLocationInput,
    complex: ResidentialComplex,
    currentUser: JwtAccessPayload,
  ): Promise<ResolvedLocation> {
    const base: ResolvedLocation = {
      locationType: raw.locationType,
      locationText: raw.locationText?.trim() || null,
      lat: null,
      lng: null,
      gpsAccuracyMeters: null,
      buildingId: null,
      floor: raw.floor ?? null,
      amenityId: null,
      locationTagId: null,
    };

    switch (raw.locationType) {
      case MaintenanceLocationType.TAG: {
        if (!raw.locationTagCode) {
          throw new CustomError({
            message: 'Falta el código del punto escaneado',
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: MaintenanceErrorCode.MAINTENANCE_LOCATION_REQUIRED,
          });
        }

        const tag = await this.resolveTagByCode(
          complex.id,
          raw.locationTagCode,
        );

        return {
          ...base,
          locationTagId: tag.id,
          buildingId: tag.buildingId ?? null,
          floor: tag.floor ?? raw.floor ?? null,
          amenityId: tag.amenityId ?? null,
          // La coordenada del tag gana sobre la del celular: se midió una vez,
          // en sitio y con calma.
          lat: tag.lat ?? raw.lat ?? null,
          lng: tag.lng ?? raw.lng ?? null,
          gpsAccuracyMeters:
            tag.lat != null ? 0 : (raw.gpsAccuracyMeters ?? null),
          locationText: base.locationText ?? tag.name,
        };
      }

      case MaintenanceLocationType.AMENITY: {
        if (!raw.amenityId) {
          throw new CustomError({
            message: 'Debes indicar la zona común',
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: MaintenanceErrorCode.MAINTENANCE_LOCATION_REQUIRED,
          });
        }

        const amenity = await this.assertAmenityBelongs(
          raw.amenityId,
          complex.id,
        );

        return {
          ...base,
          amenityId: amenity.id,
          locationText: base.locationText ?? amenity.name,
        };
      }

      case MaintenanceLocationType.TREE: {
        if (!raw.buildingId && !base.locationText) {
          throw new CustomError({
            message: 'Indica la torre o describe dónde queda el daño',
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: MaintenanceErrorCode.MAINTENANCE_LOCATION_REQUIRED,
          });
        }

        if (raw.buildingId) {
          await this.assertBuildingBelongs(
            raw.buildingId,
            complex.id,
            currentUser,
          );
        }

        return { ...base, buildingId: raw.buildingId ?? null };
      }

      case MaintenanceLocationType.GPS:
      default: {
        if (raw.lat == null || raw.lng == null) {
          throw new CustomError({
            message: 'No se recibieron las coordenadas del dispositivo',
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: MaintenanceErrorCode.MAINTENANCE_LOCATION_REQUIRED,
          });
        }

        this.assertWithinComplex(
          complex,
          raw.lat,
          raw.lng,
          raw.gpsAccuracyMeters ?? 0,
        );

        return {
          ...base,
          lat: raw.lat,
          lng: raw.lng,
          gpsAccuracyMeters: raw.gpsAccuracyMeters ?? null,
          buildingId: raw.buildingId ?? null,
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async resolveTagByCode(
    complexId: string,
    code: string,
  ): Promise<MaintenanceLocationTag> {
    const tag = await this.tagRepo.findOne({
      where: {
        complexId,
        code: code.trim().toUpperCase(),
        deletedAt: IsNull(),
      },
      relations: ['building', 'amenity'],
    });

    if (!tag) {
      throw new CustomError({
        message: `El código ${code} no corresponde a ningún punto de este complejo`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TAG_NOT_FOUND,
      });
    }

    if (!tag.isActive) {
      throw new CustomError({
        message: `El punto ${tag.name} está desactivado`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MaintenanceErrorCode.MAINTENANCE_TAG_INACTIVE,
      });
    }

    return tag;
  }

  /**
   * El punto tiene que caer dentro del conjunto.
   *
   * Se le resta el error declarado antes de comparar: castigar a quien reporta
   * de pie junto a la piscina porque su celular midió con ochenta metros de
   * margen es cerrarle el módulo a media copropiedad. Si el complejo no tiene
   * coordenadas configuradas no hay nada contra qué validar y se deja pasar.
   */
  private assertWithinComplex(
    complex: ResidentialComplex,
    lat: number,
    lng: number,
    accuracyMeters: number,
  ): void {
    if (complex.latitude == null || complex.longitude == null) return;

    const radius = complex.gpsRadius ?? 200;
    const distance = calculateHaversineDistance(
      Number(complex.latitude),
      Number(complex.longitude),
      lat,
      lng,
    );

    if (distance - accuracyMeters > radius) {
      throw new CustomError({
        message: `El punto reportado queda a ${Math.round(distance)} m del complejo. Solo se pueden reportar daños dentro de la copropiedad`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_LOCATION_OUT_OF_COMPLEX,
      });
    }
  }

  private async assertBuildingBelongs(
    buildingId: string,
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    const building = await this.buildingService.findById(
      buildingId,
      currentUser,
    );

    if (building.complexId !== complexId) {
      throw new CustomError({
        message: 'La torre indicada no pertenece a este complejo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_LOCATION_MISMATCH,
      });
    }
  }

  private async assertAmenityBelongs(amenityId: string, complexId: string) {
    const amenity = await this.amenitiesService.findByIdOrFail(amenityId);

    if (amenity.complexId !== complexId) {
      throw new CustomError({
        message: 'La zona común indicada no pertenece a este complejo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MaintenanceErrorCode.MAINTENANCE_LOCATION_MISMATCH,
      });
    }

    return amenity;
  }
}
