import { HttpStatus, Injectable, Logger } from '@nestjs/common';
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
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { User } from '../../users/entities/user.entity';

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
    private readonly dataSource: DataSource,
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

    const complex = this.complexRepo.create({
      ...input,
      plan,
      maxUnits,
      status: ComplexStatus.PENDING_SETUP,
      ownerId: currentUser.sub,
    });

    const saved = await this.complexRepo.save(complex);
    this.logger.log(`Complejo creado: ${saved.id} — "${saved.name}" por usuario ${currentUser.sub}`);
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
    const complex = await this.complexRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['owner', 'buildings', 'buildings.units'],
    });

    if (!complex) {
      throw new CustomError({
        message: `Complejo con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
      });
    }

    this.assertAccess(complex, currentUser);
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

    Object.assign(complex, input);
    const updated = await this.complexRepo.save(complex);
    this.logger.log(`Complejo actualizado: ${updated.id}`);
    return updated;
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
    complex.status = status;
    return this.complexRepo.save(complex);
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
   */
  assertAccess(complex: ResidentialComplex, user: JwtAccessPayload): void {
    // SUPER_ADMIN tiene acceso irrestricto a cualquier complejo
    if (user.roles.includes(ValidRoles.SUPER_ADMIN_ROL)) return;

    // COMPLEX_ROL: debe ser el owner del complejo
    if (
      user.roles.includes(ValidRoles.COMPLEX_ROL) &&
      complex.ownerId === user.sub
    ) {
      throw new CustomError({
        message: 'No tienes permiso para acceder a este complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    // SECURITY / SUPERVISOR / otros: deben pertenecer al complejo via complexId en JWT
    if (
      !user.roles.includes(ValidRoles.COMPLEX_ROL) &&
      user.complexId !== complex.id
    ) {
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

  async updateModules(complexId: string, modules: string[]): Promise<ResidentialComplex> {
    const complex = await this.complexRepo.findOneOrFail({ where: { id: complexId } });
    complex.enabledModules = modules;
    return this.complexRepo.save(complex);
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
