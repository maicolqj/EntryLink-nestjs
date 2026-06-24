import {
  ConflictException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, IsNull, Repository } from 'typeorm';

import { ResidentialComplex } from '../entities/residential-complex.entity';
import { CreateComplexInput } from '../dto/inputs/create-complex.input';
import { UpdateComplexInput } from '../dto/inputs/update-complex.input';
import { FilterComplexInput } from '../dto/inputs/filter-complex.input';
import { PaginatedComplexesResponse } from '../dto/responses/paginated-complexes.response';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { ComplexStatus } from '../enums/complex-status.enum';
import { ComplexPlan } from '../enums/complex-plan.enum';
import { ComplexType } from '../enums/complex-type.enum';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexErrorCode, GeneralErrorCode, UserErrorCode } from '../../shared/constans/error-codes.constants';
import { ComplexModule } from '../enums/complex-module.enum';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { NearbyComplexResponse } from '../dto/responses/nearby-complex.response';
import { calculateHaversineDistance } from '../../shared/utils/gps.utils';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { Unit } from '../entities/unit.entity';
import { UnitStatus } from '../enums/unit-status.enum';
import { AuditService }    from '../../audit/services/audit.service';
import { AuditAction }     from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { GeocodingService } from './geocoding.service';
import { SupervisorVisit }   from '../../supervisor-visits/entities/supervisor-visit.entity';
import { SupervisorVisitStatus } from '../../supervisor-visits/enums/supervisor-visit-status.enum';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { RegisterComplexDto } from '../dto/inputs/register-complex.dto';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { BK } from '../../../core/infrastructure/cache/business-cache.constants';
import { seedPucForComplex } from '../../../core/database/seeds/puc.seed';

// Límite de unidades por plan
const PLAN_UNIT_LIMITS: Record<ComplexPlan, number> = {
  [ComplexPlan.FREE]: 10,
  [ComplexPlan.BASIC]: 50,
  [ComplexPlan.PRO]: 200,
  [ComplexPlan.ENTERPRISE]: 99_999,
};

@Injectable()
export class ResidentialComplexService {
  private readonly logger = new Logger(ResidentialComplexService.name);

  constructor(
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(SupervisorVisit)
    private readonly supervisorVisitRepo: Repository<SupervisorVisit>,

    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly geocodingService: GeocodingService,
    private readonly storageService: R2StorageService,
    private readonly cacheService: CacheService,
  ) { }

  // ================================================================
  // CREAR COMPLEJO
  // ================================================================

  async create(
    input: CreateComplexInput,
    currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    // Verificar que el slug no exista ya
    const slug = this.generateSlug(input.name);
    const exists = await this.complexRepo.findOne({
      where: { slug, deletedAt: IsNull() },
    });

    if (exists) {
      throw new CustomError({
        message: `Ya existe un complejo con un nombre similar a "${input.name}"`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: ComplexErrorCode.COMPLEX_ALREADY_EXISTS,
      });
    }

    const plan = input.plan ?? ComplexPlan.FREE;
    const maxUnits = PLAN_UNIT_LIMITS[plan];

    // Hashear password si fue enviado
    const { password, ...restInput } = input;
    const hashedPassword = password
      ? await bcrypt.hash(password, Number(process.env.HASHSALT) || 10)
      : undefined;

    const complex = this.complexRepo.create({
      ...restInput,
      plan,
      maxUnits,
      status: ComplexStatus.PENDING_SETUP,
      ownerId: currentUser.sub,
      ...(hashedPassword && { password: hashedPassword, passwordSet: true }),
    });

    // Geocodificar si el admin no proveyó coordenadas manualmente
    if (input.latitude == null || input.longitude == null) {
      const coords = await this.geocodingService.geocodeAddress(
        complex.address,
        complex.city,
        complex.state,
        complex.country ?? 'Colombia',
      );
      complex.latitude  = coords.lat;
      complex.longitude = coords.lng;
    }

    const saved = await this.complexRepo.save(complex);
    this.logger.log(`Complejo creado: ${saved.id} — "${saved.name}" por usuario ${currentUser.sub}`);

    // Sembrar el PUC contable base (idempotente, best-effort: no rompe el alta)
    await this.seedPucSafe(saved.id);

    void this.auditService.log({
      entityType:      AuditEntityType.ResidentialComplex,
      entityId:        saved.id,
      action:          AuditAction.CREATE,
      newValue:        { id: saved.id, name: saved.name, plan: saved.plan, status: saved.status },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       saved.id,
      description:     `Complejo residencial creado: "${saved.name}"`,
    });

    return saved;
  }

  // ================================================================
  // LISTAR COMPLEJOS (paginado + filtros)
  // ================================================================

  async findAll(
    pagination: PaginationInput,
    filters: FilterComplexInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedComplexesResponse> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.complexRepo
      .createQueryBuilder('complex')
      .leftJoinAndSelect('complex.owner', 'owner')
      .leftJoinAndSelect(
        'complex.legalRepresentative',
        'legalRepresentative',
        'legalRepresentative.deleted_at IS NULL',
      )
      .where('complex.deleted_at IS NULL');

    // Si NO es SUPER_ADMIN, solo ve sus propios complejos
    const isSuperAdmin = currentUser.roles.includes(ValidRoles.SUPER_ADMIN_ROL);
    const isCompilanceOficerAdmin = currentUser.roles.includes(ValidRoles.COMPILANCE_OFFICER_ROL);
    if (!isSuperAdmin && !isCompilanceOficerAdmin) {
      qb.andWhere('complex.owner_id = :ownerId', { ownerId: currentUser.sub });
    }

    // Filtros opcionales
    if (filters?.search) {
      qb.andWhere(
        '(complex.name ILIKE :search OR complex.city ILIKE :search OR complex.address ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    if (filters?.type) qb.andWhere('complex.type = :type', { type: filters.type });
    if (filters?.plan) qb.andWhere('complex.plan = :plan', { plan: filters.plan });
    if (filters?.status) qb.andWhere('complex.status = :status', { status: filters.status });
    if (filters?.city) qb.andWhere('complex.city ILIKE :city', { city: `%${filters.city}%` });

    qb.orderBy('complex.createdAt', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
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

  // ================================================================
  // BUSCAR POR ID
  // ================================================================

  async findById(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    const cacheKey = BK.complex.one(id);
    const cached = await this.cacheService.get<ResidentialComplex>({ key: cacheKey });

    let complex: ResidentialComplex;
    if (cached) {
      complex = cached;
    } else {
      complex = await this.complexRepo.findOne({
        where: { id, deletedAt: IsNull() },
        relations: ['owner', 'buildings', 'buildings.units'],
      });
      if (complex) {
        await this.cacheService.set({ key: cacheKey, data: complex, options: { ttl: BK.complex.TTL } });
      }
    }

    if (!complex) {
      throw new CustomError({
        message: `Complejo con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
      });
    }

    await this.assertAccess(complex, currentUser);
    return complex;
  }

  // ================================================================
  // ACTUALIZAR
  // ================================================================

  async update(
    input: UpdateComplexInput,
    currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    const complex = await this.findById(input.id, currentUser);

    // Si cambia el plan, actualizar el límite de unidades
    if (input.plan && input.plan !== complex.plan) {
      complex.maxUnits = PLAN_UNIT_LIMITS[input.plan];
    }

    // Extraer legalRepresentativeId para manejarlo explícitamente:
    // "" o null → limpia el campo; UUID → asigna; undefined → no modifica
    const { legalRepresentativeId, ...restInput } = input;
    if (legalRepresentativeId !== undefined) {
      if (legalRepresentativeId) {
        await this.assertValidLegalRepresentative(legalRepresentativeId);
      }
      complex.legalRepresentativeId = legalRepresentativeId || null;
      // Limpiar el objeto eager en caché para que TypeORM use el FK escalar
      // y no sobreescriba con el representante anterior cargado en memoria.
      complex.legalRepresentative = undefined;
    }

    Object.assign(complex, restInput);

    // Re-geocodificar si cambió algún campo de dirección y el admin no proveyó coords manuales
    const addressChanged = input.address != null || input.city != null || input.state != null;
    if (addressChanged && input.latitude == null && input.longitude == null) {
      const coords = await this.geocodingService.geocodeAddress(
        complex.address,
        complex.city,
        complex.state,
        complex.country ?? 'Colombia',
      );
      complex.latitude  = coords.lat;
      complex.longitude = coords.lng;
    }

    const saved = await this.complexRepo.save(complex);
    await this.cacheService.delete({ key: BK.complex.one(saved.id) });
    this.logger.log(`Complejo actualizado: ${saved.id}`);

    void this.auditService.log({
      entityType:      AuditEntityType.ResidentialComplex,
      entityId:        saved.id,
      action:          AuditAction.UPDATE,
      newValue:        { ...restInput, plan: input.plan, legalRepresentativeId },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       saved.id,
      description:     `Complejo actualizado: "${saved.name}"`,
    });

    // Recargar desde BD para que la relación eager devuelva el representante actualizado.
    return this.complexRepo.findOne({ where: { id: saved.id, deletedAt: IsNull() } });
  }

  // ================================================================
  // CAMBIAR ESTADO
  // ================================================================

  async changeStatus(
    id: string,
    status: ComplexStatus,
    currentUser: JwtAccessPayload,  
  ): Promise<ResidentialComplex> {
    const complex = await this.findById(id, currentUser);

    const previousStatus = complex.status;

    return this.dataSource.transaction(async (manager) => {
      complex.status = status;
      const saved = await manager.save(ResidentialComplex, complex);

      // Al desactivar el complejo, marcar todas sus unidades como DISABLED.
      // Al reactivar NO se restauran — cada unidad se gestiona de forma independiente.
      if (status === ComplexStatus.INACTIVE) {
        await manager.update(Unit, { complexId: id }, { status: UnitStatus.DISABLED });
        this.logger.warn(`Complejo ${id} desactivado — unidades marcadas como DISABLED`);
      }

      // Al activar un complejo (p. ej. aprobación de registro PENDING_REVIEW→ACTIVE),
      // garantizar que tenga su PUC contable sembrado (idempotente, best-effort).
      if (status === ComplexStatus.ACTIVE && previousStatus !== ComplexStatus.ACTIVE) {
        await this.seedPucSafe(id);
      }

      await this.cacheService.delete({ key: BK.complex.one(id) });

      void this.auditService.log({
        entityType:      AuditEntityType.ResidentialComplex,
        entityId:        id,
        action:          AuditAction.UPDATE,
        previousValue:   { status: previousStatus },
        newValue:        { status },
        performedById:   currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId:       id,
        description:     `Estado del complejo cambiado: ${previousStatus} → ${status}`,
      });

      return saved;
    });
  }

  // ================================================================
  // SOFT DELETE
  // ================================================================

  async remove(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<{ success: boolean; message: string }> {
    const complex = await this.findById(id, currentUser);

    complex.deletedAt = new Date();
    await this.complexRepo.save(complex);
    await this.cacheService.delete({ key: BK.complex.one(id) });
    this.logger.warn(`Complejo eliminado (soft): ${id} por usuario ${currentUser.sub}`);

    return { success: true, message: `Complejo "${complex.name}" eliminado correctamente` };
  }

  // ================================================================
  // RESTAURAR
  // ================================================================

  async restore(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    const complex = await this.complexRepo.findOne({ where: { id } });

    if (!complex) {
      throw new CustomError({
        message: `Complejo con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
      });
    }

    if (!complex.deletedAt) {
      throw new CustomError({
        message: 'El complejo no está eliminado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    complex.deletedAt = null;
    complex.status = ComplexStatus.PENDING_SETUP;
    return this.complexRepo.save(complex);
  }

  // ================================================================
  // HELPERS
  // ================================================================

  /**
   * Verifica que el usuario autenticado tenga acceso al complejo.
   * SUPER_ADMIN siempre tiene acceso. Los demás solo al suyo.
   * SUPERVISOR_ROL requiere visita activa en el complejo específico.
   */
  async assertAccess(complex: ResidentialComplex, user: JwtAccessPayload): Promise<void> {
    if (user.roles.includes(ValidRoles.SUPER_ADMIN_ROL)) return;

    // COMPLEX_ROL: owner directo O complejo asignado en el perfil
    if (user.roles.includes(ValidRoles.COMPLEX_ROL)) {
      if (complex.ownerId === user.sub || user.complexId === complex.id) return;
      throw new CustomError({
        message: 'No tienes permiso para acceder a este complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    // SUPERVISOR_ROL: requiere visita activa en este complejo específico
    if (user.roles.includes(ValidRoles.SUPERVISOR_ROL)) {
      await this.assertSupervisorActiveVisit(user.sub, complex.id);
      return;
    }

    // SECURITY y otros: deben pertenecer al complejo via complexId en JWT
    if (user.complexId !== complex.id) {
      throw new CustomError({
        message: 'No tienes permiso para acceder a este complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }
  }

  /**
   * Verifica acceso al complejo sin cargar relaciones.
   *
   * - SUPER_ADMIN:  acceso irrestricto.
   * - COMPLEX_ROL:  es owner del complejo (ownerId === user.sub)
   *                 O tiene el complejo asignado en su perfil (user.complexId === complexId).
   * - Otros roles:  su complexId en el JWT debe coincidir con el ID del complejo.
   */
  async assertComplexAccess(complexId: string, user: JwtAccessPayload): Promise<void> {
    if (user.roles.includes(ValidRoles.SUPER_ADMIN_ROL)) return;

    if (user.roles.includes(ValidRoles.COMPLEX_ROL)) {
      // Caso 1: el complejo está asignado en el JWT del usuario
      if (user.complexId === complexId) return;

      // Caso 2: el usuario es el owner directo del complejo en BD
      const complex = await this.complexRepo.findOne({
        where: { id: complexId },
        select: ['id', 'ownerId'],
      });
      if (complex && complex.ownerId === user.sub) return;

      throw new CustomError({
        message: 'No tienes permiso para acceder a este complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    // SUPERVISOR_ROL: requiere visita activa en este complejo específico
    if (user.roles.includes(ValidRoles.SUPERVISOR_ROL)) {
      await this.assertSupervisorActiveVisit(user.sub, complexId);
      return;
    }

    if (user.complexId !== complexId) {
      throw new CustomError({
        message: 'No tienes acceso a recursos de otro complejo residencial',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }
  }

  /**
   * Verifica que el complejo no haya superado el límite de unidades de su plan.
   */
  async assertUnitsLimit(complexId: string, currentCount: number): Promise<void> {
    const complex = await this.complexRepo.findOne({
      where: { id: complexId, deletedAt: IsNull() },
    });

    if (!complex) {
      throw new CustomError({
        message: `Complejo con ID "${complexId}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
      });
    }

    if (currentCount >= complex.maxUnits) {
      throw new CustomError({
        message: `El plan "${complex.plan}" solo permite ${complex.maxUnits} unidades. Actualiza tu plan.`,
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: ComplexErrorCode.COMPLEX_SUBSCRIPTION_EXPIRED,
      });
    }
  }

  // ================================================================
  // ACTUALIZAR MÓDULOS HABILITADOS
  // ================================================================

  async updateEnabledModules(complexId: string, modules: ComplexModule[]): Promise<ResidentialComplex> {
    const complex = await this.complexRepo.findOne({
      where: { id: complexId, deletedAt: IsNull() },
    });

    if (!complex) {
      throw new NotFoundException(`Complejo con ID "${complexId}" no encontrado`);
    }

    complex.enabledModules = modules;
    const updated = await this.complexRepo.save(complex);
    this.logger.log(`Módulos actualizados para complejo ${complexId}: [${modules.join(', ')}]`);
    return updated;
  }

  /**
   * Verifica que el usuario existe, está activo y no ha sido eliminado.
   * Lanza error descriptivo si alguna condición no se cumple.
   */
  /**
   * Siembra el PUC contable base de un complejo sin romper el flujo que la invoca.
   * Idempotente (salta códigos existentes). Cualquier error solo se loguea.
   */
  private async seedPucSafe(complexId: string): Promise<void> {
    try {
      await seedPucForComplex(this.dataSource, complexId);
    } catch (err: any) {
      this.logger.error(`No se pudo sembrar el PUC del complejo ${complexId}: ${err?.message}`, err?.stack);
    }
  }

  private async assertValidLegalRepresentative(userId: string): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'status', 'deletedAt'], 
    });

    if (!user) {
      throw new CustomError({
        message: `El usuario con ID "${userId}" no existe en el sistema`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    if (user.deletedAt) {
      throw new CustomError({
        message: 'El usuario indicado como representante legal ha sido eliminado del sistema',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new CustomError({
        message: `El usuario indicado como representante legal no está activo (estado actual: ${user.status})`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }
  }

  // ================================================================
  // BUSCAR COMPLEJOS CERCANOS POR GPS
  // ================================================================

  /**
   * Devuelve los complejos activos dentro de `radiusMeters` metros del punto dado.
   * Estrategia: bounding box en SQL para reducir el dataset, luego Haversine exacto en memoria.
   */
  async findNearby(
    lat: number,
    lng: number,
    radiusMeters: number,
  ): Promise<NearbyComplexResponse[]> {
    // ~0.001° ≈ 111m en latitud; usamos factor 1.5 para que el bounding box sea holgado
    const degreeMargin = (radiusMeters / 111_000) * 1.5;

    const candidates = await this.complexRepo
      .createQueryBuilder('c')
      .select(['c.id', 'c.name', 'c.address', 'c.city', 'c.latitude', 'c.longitude', 'c.gpsRadius'])
      .where('c.status = :status', { status: ComplexStatus.ACTIVE })
      .andWhere('c.deleted_at IS NULL')
      .andWhere('c.latitude IS NOT NULL')
      .andWhere('c.longitude IS NOT NULL')
      .andWhere('c.latitude BETWEEN :minLat AND :maxLat', {
        minLat: lat - degreeMargin,
        maxLat: lat + degreeMargin,
      })
      .andWhere('c.longitude BETWEEN :minLng AND :maxLng', {
        minLng: lng - degreeMargin,
        maxLng: lng + degreeMargin,
      })
      .getMany();

    return candidates
      .map(c => ({
        id: c.id,
        name: c.name,
        address: c.address,
        city: c.city,
        gpsRadius: c.gpsRadius ?? null,
        distanceMeters: Math.round(
          calculateHaversineDistance(lat, lng, Number(c.latitude), Number(c.longitude)),
        ),
      }))
      .filter(c => c.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  private async assertSupervisorActiveVisit(supervisorId: string, complexId: string): Promise<void> {
    const visit = await this.supervisorVisitRepo.findOne({
      where: { supervisorId, complexId, status: SupervisorVisitStatus.ACTIVE },
    });

    if (!visit) {
      throw new CustomError({
        message: 'No tienes una visita activa en este complejo. Debes hacer check-in primero',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }
  }

  // ================================================================
  // REGISTRO PÚBLICO (PENDING_REVIEW)
  // ================================================================

  async registerComplex(
    dto: RegisterComplexDto,
    rutFile: Express.Multer.File,
    legalRepDocument: Express.Multer.File,
  ): Promise<{
    id: string;
    name: string;
    type: ComplexType;
    status: ComplexStatus;
    email: string;
    createdAt: Date;
  }> {
    const slug = this.generateSlug(dto.name);

    const [existingSlug, existingEmail] = await Promise.all([
      this.complexRepo.findOne({ where: { slug } }),
      this.complexRepo.findOne({ where: { email: dto.email } }),
    ]);

    if (existingSlug) {
      throw new ConflictException(`Ya existe un complejo con un nombre similar a "${dto.name}"`);
    }
    if (existingEmail) {
      throw new ConflictException(`El email "${dto.email}" ya está registrado`);
    }

    const folder = this.storageService.buildFolder('documents', slug);

    let rutPublicId: string | undefined;
    let legalRepPublicId: string | undefined;
    let rutFileUrl: string;
    let legalRepDocumentUrl: string;

    try {
      const rutResult = await this.storageService.uploadBuffer(
        rutFile.buffer,
        folder,
        rutFile.originalname,
        'raw',
      );
      rutPublicId = rutResult.publicId;
      rutFileUrl = rutResult.url;

      try {
        const legalResult = await this.storageService.uploadBuffer(
          legalRepDocument.buffer,
          folder,
          legalRepDocument.originalname,
          'raw',
        );
        legalRepPublicId = legalResult.publicId;
        legalRepDocumentUrl = legalResult.url;
      } catch (err) {
        await this.storageService.deleteByPublicId(rutPublicId, 'raw').catch(() => {});
        throw err;
      }
    } catch (err: any) {
      this.logger.error(`Error subiendo documentos a R2: ${err.message}`);
      throw new InternalServerErrorException('Error al procesar los documentos. Intenta de nuevo.');
    }

    const isTower = dto.type === ComplexType.APARTMENT_COMPLEX || dto.type === ComplexType.MIXED_COMPLEX;

    try {
      const complex = this.complexRepo.create({
        name: dto.name,
        type: dto.type,
        totalUnits: dto.totalUnits,
        numberOfTowers: isTower ? dto.numberOfTowers : undefined,
        legalRepresentativeName: dto.legalRepresentativeName,
        email: dto.email,
        phoneNumber: dto.phone,
        rutFileUrl,
        legalRepDocumentUrl,
        status: ComplexStatus.PENDING_REVIEW,
      });

      const saved = await this.complexRepo.save(complex);
      this.logger.log(`Complejo registrado (PENDING_REVIEW): ${saved.id} — "${saved.name}"`);

      return {
        id: saved.id,
        name: saved.name,
        type: saved.type,
        status: saved.status,
        email: saved.email,
        createdAt: saved.createdAt,
      };
    } catch (err: any) {
      await Promise.allSettled([
        this.storageService.deleteByPublicId(rutPublicId, 'raw'),
        this.storageService.deleteByPublicId(legalRepPublicId, 'raw'),
      ]);
      this.logger.error(`Error guardando complejo en BD: ${err.message}`);
      throw new InternalServerErrorException('Error al registrar el complejo. Intenta de nuevo.');
    }
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 170);
  }
}