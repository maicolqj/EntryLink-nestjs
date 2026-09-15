import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import { Pet } from '../entities/pet.entity';
import { PetStatus } from '../enums/pet-status.enum';
import { RegisterPetDto } from '../dto/inputs/register-pet.input';
import { UpdatePetInput } from '../dto/inputs/update-pet.input';
import { FilterPetsInput } from '../dto/inputs/filter-pets.input';
import { ApprovePetInput } from '../dto/inputs/approve-pet.input';
import { PaginatedPetsResponse } from '../dto/responses/paginated-pets.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  GeneralErrorCode,
  PetErrorCode,
} from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService } from '../../residential-complex/services/unit.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import {
  isPetsModuleEnabled,
  readBoolean,
  readOptionalBoolean,
} from '../utils/pets-module.util';

/** Datos de creación: el DTO del REST más la foto ya subida a R2. */
export type CreatePetData = RegisterPetDto & { photoUrl: string };

/**
 * Estados en los que la ficha sigue siendo del residente: todavía no entró al
 * censo, así que puede corregirla o eliminarla sin pedirle permiso a nadie.
 */
const EDITABLE_BY_RESIDENT = [PetStatus.PENDING_APPROVAL, PetStatus.REJECTED];

/** Estados que ocupan cupo en la unidad. Una mascota retirada no cuenta. */
const COUNTED_STATES = [PetStatus.PENDING_APPROVAL, PetStatus.ACTIVE];

/** Quien opera el complejo: ve el censo completo para poder identificar. */
const STAFF_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.SECURITY_ROL,
];

/** Días antes del vencimiento en que se insiste. Evita el aviso diario. */
const REMINDER_THRESHOLDS = [30, 15, 7, 1];

@Injectable()
export class PetsService {
  private readonly logger = new Logger(PetsService.name);

  constructor(
    @InjectRepository(Pet)
    private readonly petRepo: Repository<Pet>,
    private readonly complexService: ResidentialComplexService,
    private readonly unitService: UnitService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  // ================================================================
  // REGISTRAR FICHA
  // ================================================================

  /**
   * Registra la mascota en estado PENDING_APPROVAL.
   *
   * La póliza de las razas de manejo especial NO se exige aquí a propósito:
   * bloquear el registro dejaría al perro fuera del censo, que es justo el
   * animal que más importa tener identificado. Se exige para aprobar la ficha.
   */
  async create(
    data: CreatePetData,
    currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    const complex = await this.complexService.findById(
      data.complexId,
      currentUser,
    );
    this.assertModuleEnabled(complex, currentUser);

    const { unitId, residentId } = await this.resolveUnitContext(
      data.complexId,
      data.unitId,
      currentUser,
    );

    if (complex.petsMaxPerUnit > 0) {
      const current = await this.petRepo.count({
        where: COUNTED_STATES.map((status) => ({
          unitId,
          status,
          deletedAt: IsNull(),
        })),
      });

      if (current >= complex.petsMaxPerUnit) {
        throw new CustomError({
          message: `La unidad ya tiene el máximo de ${complex.petsMaxPerUnit} mascota(s) permitido`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: PetErrorCode.PET_MAX_PER_UNIT_REACHED,
        });
      }
    }

    await this.assertMicrochipAvailable(data.complexId, data.microchipCode);

    const pet = this.petRepo.create({
      name: data.name,
      species: data.species,
      breed: data.breed,
      color: data.color,
      distinguishingMarks: data.distinguishingMarks,
      sex: data.sex,
      size: data.size,
      birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
      photoUrl: data.photoUrl,
      hasMicrochip: readBoolean(data.hasMicrochip),
      microchipCode: data.microchipCode,
      // Se vuelve a convertir aquí aunque el DTO ya lo haga: el servicio es
      // quien decide lo que queda en la base, y un `"false"` que se cuele por
      // otro llamador marcaría la mascota como raza de manejo especial.
      isSpecialBreed: readBoolean(data.isSpecialBreed),
      insuranceCompany: data.insuranceCompany,
      insurancePolicyNumber: data.insurancePolicyNumber,
      insuranceExpiresAt: data.insuranceExpiresAt
        ? new Date(data.insuranceExpiresAt)
        : undefined,
      rabiesVaccineAt: data.rabiesVaccineAt
        ? new Date(data.rabiesVaccineAt)
        : undefined,
      sterilized: readOptionalBoolean(data.sterilized),
      status: PetStatus.PENDING_APPROVAL,
      unitId,
      residentId,
      complexId: data.complexId,
      createdByUserId:
        currentUser.entityType === 'user' ? currentUser.sub : undefined,
    });

    const saved = await this.petRepo.save(pet);
    this.logger.log(
      `Mascota registrada: ${saved.id} — ${saved.name} — unidad ${unitId}`,
    );

    this.notifyStaff(
      saved,
      NotificationType.PET_REGISTERED,
      'Nueva mascota por validar',
      `Se registró ${saved.name}${saved.isSpecialBreed ? ' (raza de manejo especial)' : ''} y está pendiente de validación.`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar registro de mascota ${saved.id}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.Pet,
      entityId: saved.id,
      action: AuditAction.CREATE,
      newValue: {
        id: saved.id,
        name: saved.name,
        species: saved.species,
        isSpecialBreed: saved.isSpecialBreed,
        unitId,
        complexId: data.complexId,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: data.complexId,
      description: `Mascota registrada: ${saved.name} — unidad ${unitId}`,
    });

    return this.loadRelations(saved.id);
  }

  // ================================================================
  // EDITAR FICHA
  // ================================================================

  async update(
    input: UpdatePetInput,
    currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    const pet = await this.findById(input.petId, currentUser);
    this.assertFichaUnlocked(pet, currentUser);
    const previous = { ...pet };

    if (input.microchipCode && input.microchipCode !== pet.microchipCode) {
      await this.assertMicrochipAvailable(
        pet.complexId,
        input.microchipCode,
        pet.id,
      );
    }

    // Las notas internas son de la administración: el residente no se escribe
    // su propio expediente.
    if (input.notes !== undefined && !this.isAdminStaff(currentUser)) {
      throw new CustomError({
        message: 'Solo la administración puede editar las notas internas',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    Object.assign(pet, {
      name: input.name ?? pet.name,
      species: input.species ?? pet.species,
      breed: input.breed ?? pet.breed,
      color: input.color ?? pet.color,
      distinguishingMarks: input.distinguishingMarks ?? pet.distinguishingMarks,
      sex: input.sex ?? pet.sex,
      size: input.size ?? pet.size,
      birthDate: input.birthDate ? new Date(input.birthDate) : pet.birthDate,
      hasMicrochip: readOptionalBoolean(input.hasMicrochip) ?? pet.hasMicrochip,
      microchipCode: input.microchipCode ?? pet.microchipCode,
      isSpecialBreed:
        readOptionalBoolean(input.isSpecialBreed) ?? pet.isSpecialBreed,
      insuranceCompany: input.insuranceCompany ?? pet.insuranceCompany,
      insurancePolicyNumber:
        input.insurancePolicyNumber ?? pet.insurancePolicyNumber,
      insuranceExpiresAt: input.insuranceExpiresAt
        ? new Date(input.insuranceExpiresAt)
        : pet.insuranceExpiresAt,
      rabiesVaccineAt: input.rabiesVaccineAt
        ? new Date(input.rabiesVaccineAt)
        : pet.rabiesVaccineAt,
      sterilized: readOptionalBoolean(input.sterilized) ?? pet.sterilized,
      notes: input.notes ?? pet.notes,
    });

    const saved = await this.petRepo.save(pet);

    void this.auditService.log({
      entityType: AuditEntityType.Pet,
      entityId: saved.id,
      action: AuditAction.UPDATE,
      previousValue: {
        name: previous.name,
        breed: previous.breed,
        microchipCode: previous.microchipCode,
        isSpecialBreed: previous.isSpecialBreed,
      },
      newValue: {
        name: saved.name,
        breed: saved.breed,
        microchipCode: saved.microchipCode,
        isSpecialBreed: saved.isSpecialBreed,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Ficha actualizada: ${saved.name}`,
    });

    return this.loadRelations(saved.id);
  }

  /** Reemplaza la foto. La sube el controller; aquí solo se persiste la URL. */
  async updatePhotoUrl(
    petId: string,
    photoUrl: string,
    currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    const pet = await this.findById(petId, currentUser);
    this.assertFichaUnlocked(pet, currentUser);
    pet.photoUrl = photoUrl;
    return this.petRepo.save(pet);
  }

  /** Guarda la URL del carné de vacunación subido por REST. */
  async updateVaccinationCardUrl(
    petId: string,
    vaccinationCardUrl: string,
    currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    const pet = await this.findById(petId, currentUser);
    pet.vaccinationCardUrl = vaccinationCardUrl;
    return this.petRepo.save(pet);
  }

  // ================================================================
  // APROBAR / RECHAZAR / SUSPENDER
  // ================================================================

  /**
   * Valida la ficha. Aquí SÍ se exige la póliza de la raza de manejo especial:
   * aprobar sin ella es lo que deja a la copropiedad respondiendo si el animal
   * muerde a alguien.
   */
  async approve(
    input: ApprovePetInput,
    currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    const pet = await this.findById(input.petId, currentUser);

    if (pet.status === PetStatus.ACTIVE) {
      throw new CustomError({
        message: 'La mascota ya está aprobada',
        statusCode: HttpStatus.CONFLICT,
        errorCode: PetErrorCode.PET_ALREADY_APPROVED,
      });
    }

    if (
      pet.status !== PetStatus.PENDING_APPROVAL &&
      pet.status !== PetStatus.SUSPENDED
    ) {
      throw new CustomError({
        message: `No se puede aprobar una mascota en estado ${pet.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INVALID_STATUS,
      });
    }

    this.assertSpecialBreedCompliance(pet);

    pet.status = PetStatus.ACTIVE;
    pet.approvedAt = new Date();
    pet.approvedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : undefined;
    pet.rejectionReason = undefined;
    if (input.notes) pet.notes = input.notes;

    const saved = await this.petRepo.save(pet);

    this.notifyUnit(
      saved,
      NotificationType.PET_APPROVED,
      NotificationPriority.NORMAL,
      'Mascota aprobada',
      `${saved.name} quedó registrada en el censo del complejo.`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar aprobación de mascota ${saved.id}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.Pet,
      entityId: saved.id,
      action: AuditAction.APPROVE,
      previousValue: { status: PetStatus.PENDING_APPROVAL },
      newValue: { status: PetStatus.ACTIVE },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Mascota aprobada: ${saved.name}`,
    });

    return this.loadRelations(saved.id);
  }

  async reject(
    petId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    const pet = await this.findById(petId, currentUser);

    if (pet.status !== PetStatus.PENDING_APPROVAL) {
      throw new CustomError({
        message: `Solo se puede rechazar una ficha pendiente. Estado actual: ${pet.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INVALID_STATUS,
      });
    }

    pet.status = PetStatus.REJECTED;
    pet.rejectionReason = reason.trim();
    pet.approvedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : undefined;

    const saved = await this.petRepo.save(pet);

    this.notifyUnit(
      saved,
      NotificationType.PET_REJECTED,
      NotificationPriority.NORMAL,
      'Ficha de mascota rechazada',
      `La ficha de ${saved.name} fue rechazada: ${saved.rejectionReason}`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar rechazo de mascota ${saved.id}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.Pet,
      entityId: saved.id,
      action: AuditAction.REJECT,
      previousValue: { status: PetStatus.PENDING_APPROVAL },
      newValue: { status: PetStatus.REJECTED, reason: saved.rejectionReason },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Mascota rechazada: ${saved.name}`,
    });

    return this.loadRelations(saved.id);
  }

  async suspend(
    petId: string,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    const pet = await this.findById(petId, currentUser);

    if (pet.status !== PetStatus.ACTIVE) {
      throw new CustomError({
        message: `Solo se puede suspender una mascota activa. Estado actual: ${pet.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INVALID_STATUS,
      });
    }

    pet.status = PetStatus.SUSPENDED;
    pet.rejectionReason = reason.trim();

    const saved = await this.petRepo.save(pet);

    this.notifyUnit(
      saved,
      NotificationType.PET_SUSPENDED,
      NotificationPriority.HIGH,
      'Autorización de mascota suspendida',
      `La autorización de ${saved.name} fue suspendida: ${saved.rejectionReason}`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar suspensión de mascota ${saved.id}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.Pet,
      entityId: saved.id,
      action: AuditAction.SUSPEND,
      previousValue: { status: PetStatus.ACTIVE },
      newValue: { status: PetStatus.SUSPENDED, reason: saved.rejectionReason },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Mascota suspendida: ${saved.name}`,
    });

    return this.loadRelations(saved.id);
  }

  async reactivate(petId: string, currentUser: JwtAccessPayload): Promise<Pet> {
    const pet = await this.findById(petId, currentUser);

    if (pet.status !== PetStatus.SUSPENDED) {
      throw new CustomError({
        message: `Solo se puede reactivar una mascota suspendida. Estado actual: ${pet.status}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INVALID_STATUS,
      });
    }

    this.assertSpecialBreedCompliance(pet);

    pet.status = PetStatus.ACTIVE;
    pet.rejectionReason = undefined;

    const saved = await this.petRepo.save(pet);

    this.notifyUnit(
      saved,
      NotificationType.PET_REACTIVATED,
      NotificationPriority.NORMAL,
      'Mascota reactivada',
      `${saved.name} volvió a quedar autorizada en el complejo.`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar reactivación de mascota ${saved.id}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.Pet,
      entityId: saved.id,
      action: AuditAction.ACTIVATE,
      previousValue: { status: PetStatus.SUSPENDED },
      newValue: { status: PetStatus.ACTIVE },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Mascota reactivada: ${saved.name}`,
    });

    return this.loadRelations(saved.id);
  }

  /**
   * Saca a la mascota del censo. No se borra: los reportes ya radicados apuntan
   * a esta ficha y un expediente sin mascota no se puede leer después.
   */
  async remove(
    petId: string,
    reason: string | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const pet = await this.findById(petId, currentUser);

    // Eliminar un registro que nunca se aprobó no es lo mismo que retirar del
    // censo a una mascota que sí vivía ahí: la primera nunca fue parte del
    // censo, la segunda deja historial que hay que poder leer después.
    const wasInCensus = !EDITABLE_BY_RESIDENT.includes(pet.status);
    const previousStatus = pet.status;

    pet.status = PetStatus.REMOVED;
    if (reason) pet.rejectionReason = reason.trim();
    pet.deletedAt = new Date();

    await this.petRepo.save(pet);

    // La administración tiene que enterarse en los dos casos: si estaba
    // pendiente, para no quedarse revisando una ficha que ya no existe; si
    // estaba en el censo, porque el censo acaba de cambiar.
    this.notifyStaff(
      pet,
      NotificationType.PET_REMOVED,
      wasInCensus
        ? 'Mascota retirada del censo'
        : 'Registro de mascota eliminado',
      wasInCensus
        ? `${pet.name} salió del censo${reason ? `: ${reason.trim()}` : ''}.`
        : `Se eliminó el registro de ${pet.name}, que estaba pendiente de validación.`,
    ).catch((err: Error) =>
      this.logger.warn(
        `Error al notificar retiro de mascota ${pet.id}: ${err?.message}`,
      ),
    );

    void this.auditService.log({
      entityType: AuditEntityType.Pet,
      entityId: pet.id,
      action: AuditAction.DELETE,
      previousValue: { status: previousStatus },
      newValue: { status: PetStatus.REMOVED, reason },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: pet.complexId,
      description: wasInCensus
        ? `Mascota retirada del censo: ${pet.name}`
        : `Registro de mascota eliminado antes de validarse: ${pet.name}`,
    });

    return true;
  }

  // ================================================================
  // CONSULTAS
  // ================================================================

  /**
   * Censo del complejo. El residente solo ve las mascotas de SU unidad: el
   * censo completo es una lista de quién tiene qué animal en su casa, y eso no
   * es información de vecinos.
   */
  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterPetsInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedPetsResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.petRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.unit', 'unit')
      .leftJoinAndSelect('unit.building', 'building')
      .leftJoinAndSelect('p.resident', 'resident')
      .leftJoinAndSelect('resident.user', 'residentUser')
      .where('p.complexId = :complexId', { complexId });

    if (!this.isStaff(currentUser)) {
      const unitId = await this.resolveOwnUnitId(complexId, currentUser);
      qb.andWhere('p.unitId = :ownUnitId', { ownUnitId: unitId });
    } else if (filters?.unitId) {
      qb.andWhere('p.unitId = :unitId', { unitId: filters.unitId });
    }

    // Las retiradas no aparecen salvo que se pidan explícitamente: el censo es
    // de las que viven hoy en el complejo.
    if (filters?.status) {
      qb.andWhere('p.status = :status', { status: filters.status });
    } else {
      qb.andWhere('p.status != :removed', { removed: PetStatus.REMOVED });
    }

    if (filters?.species) {
      qb.andWhere('p.species = :species', { species: filters.species });
    }
    if (
      filters?.isSpecialBreed !== undefined &&
      filters?.isSpecialBreed !== null
    ) {
      qb.andWhere('p.isSpecialBreed = :special', {
        special: filters.isSpecialBreed,
      });
    }
    if (filters?.residentId) {
      qb.andWhere('p.residentId = :residentId', {
        residentId: filters.residentId,
      });
    }
    if (filters?.search) {
      qb.andWhere(
        '(p.name ILIKE :search OR p.breed ILIKE :search OR p.color ILIKE :search OR p.microchipCode ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    qb.orderBy('p.createdAt', 'DESC').skip(skip).take(limit);

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

  /** Las mascotas de la unidad del residente autenticado. */
  async findMyPets(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Pet[]> {
    const unitId = await this.resolveOwnUnitId(complexId, currentUser);

    return this.petRepo.find({
      where: {
        unitId,
        complexId,
        status: Not(PetStatus.REMOVED),
      },
      relations: ['unit', 'unit.building'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Mascotas de una unidad. La portería la usa para identificar. */
  async findByUnit(
    unitId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Pet[]> {
    const unit = await this.unitService.findById(unitId, currentUser);

    if (!this.isStaff(currentUser)) {
      const ownUnitId = await this.resolveOwnUnitId(
        unit.complexId,
        currentUser,
      );
      if (ownUnitId !== unitId) {
        throw new CustomError({
          message: 'No tienes acceso a las mascotas de esta unidad',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GeneralErrorCode.FORBIDDEN,
        });
      }
    }

    return this.petRepo.find({
      where: { unitId, status: Not(PetStatus.REMOVED) },
      relations: ['unit', 'unit.building'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string, currentUser: JwtAccessPayload): Promise<Pet> {
    const pet = await this.petRepo.findOne({
      where: { id },
      relations: ['unit', 'unit.building', 'resident', 'resident.user'],
    });

    if (!pet) {
      throw new CustomError({
        message: `Mascota con ID "${id}" no encontrada`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: PetErrorCode.PET_NOT_FOUND,
      });
    }

    await this.complexService.assertComplexAccess(pet.complexId, currentUser);

    if (!this.isStaff(currentUser)) {
      const ownUnitId = await this.resolveOwnUnitId(pet.complexId, currentUser);
      if (ownUnitId !== pet.unitId) {
        throw new CustomError({
          message: 'No tienes acceso a esta mascota',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GeneralErrorCode.FORBIDDEN,
        });
      }
    }

    return pet;
  }

  /** Uso interno del módulo: no valida permisos. */
  async findByIdInternal(id: string): Promise<Pet | null> {
    return this.petRepo.findOne({ where: { id }, relations: ['unit'] });
  }

  // ================================================================
  // VENCIMIENTOS (cron)
  // ================================================================

  /**
   * Avisa a la unidad cuando se acerca el vencimiento del refuerzo antirrábico
   * o de la póliza de RC extracontractual.
   *
   * Solo insiste en los cortes de 30, 15, 7 y 1 día: sin eso el residente
   * recibiría el mismo aviso todos los días durante un mes y terminaría
   * apagando las notificaciones del complejo entero.
   */
  async notifyExpiringDocuments(): Promise<number> {
    const candidates = await this.petRepo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.complex', 'c')
      .where('p.status = :status', { status: PetStatus.ACTIVE })
      .andWhere('p.deletedAt IS NULL')
      // Misma regla que el resto de la plataforma: sin lista de módulos, todos
      // están activos. `enabled_modules` es un simple-array (texto separado por
      // comas) y ningún otro módulo contiene la palabra, así que el LIKE basta.
      .andWhere(
        `(c.enabled_modules IS NULL OR c.enabled_modules = '' OR c.enabled_modules LIKE '%MASCOTAS%')`,
      )
      .andWhere(
        '(p.insurance_expires_at IS NOT NULL OR p.rabies_vaccine_at IS NOT NULL)',
      )
      .getMany();

    const today = this.startOfDay(new Date());
    let sent = 0;

    for (const pet of candidates) {
      const leadDays = pet.complex?.petsExpiryReminderDays ?? 30;
      const pending: string[] = [];

      if (pet.isSpecialBreed && pet.insuranceExpiresAt) {
        const days = this.daysUntil(today, new Date(pet.insuranceExpiresAt));
        if (this.shouldRemind(days, leadDays)) {
          pending.push(
            days === 0
              ? 'la póliza de responsabilidad civil vence hoy'
              : `la póliza de responsabilidad civil vence en ${days} día(s)`,
          );
        }
      }

      if (pet.rabiesVaccineAt) {
        // El refuerzo antirrábico es anual: la fecha guardada es la de la
        // última dosis, no la del vencimiento.
        const nextDose = new Date(pet.rabiesVaccineAt);
        nextDose.setFullYear(nextDose.getFullYear() + 1);
        const days = this.daysUntil(today, nextDose);
        if (this.shouldRemind(days, leadDays)) {
          pending.push(
            days === 0
              ? 'el refuerzo antirrábico vence hoy'
              : `el refuerzo antirrábico vence en ${days} día(s)`,
          );
        }
      }

      if (pending.length === 0) continue;

      await this.notifyUnit(
        pet,
        NotificationType.PET_DOCUMENT_EXPIRING,
        NotificationPriority.NORMAL,
        'Documentos de tu mascota por vencer',
        `Para ${pet.name}, ${pending.join(' y ')}.`,
      ).catch((err: Error) =>
        this.logger.warn(
          `Error al avisar vencimiento de ${pet.id}: ${err?.message}`,
        ),
      );
      sent++;
    }

    return sent;
  }

  // ================================================================
  // HELPERS
  // ================================================================

  private isSuperAdmin(user: JwtAccessPayload): boolean {
    return user.roles?.includes(ValidRoles.SUPER_ADMIN_ROL) ?? false;
  }

  private isStaff(user: JwtAccessPayload): boolean {
    return user.roles?.some((role) => STAFF_ROLES.includes(role)) ?? false;
  }

  private isAdminStaff(user: JwtAccessPayload): boolean {
    return (
      user.roles?.some((role) =>
        [
          ValidRoles.SUPER_ADMIN_ROL,
          ValidRoles.COMPLEX_ROL,
          ValidRoles.SUPERVISOR_ROL,
        ].includes(role),
      ) ?? false
    );
  }

  /**
   * El módulo se apaga desde la ficha del complejo, como cualquier otro. A la
   * administración no se le bloquea: apagarlo le quita el módulo al residente,
   * no el censo a quien administra.
   */
  private assertModuleEnabled(
    complex: { enabledModules?: string[] | null },
    currentUser: JwtAccessPayload,
  ): void {
    if (isPetsModuleEnabled(complex) || this.isStaff(currentUser)) return;

    throw new CustomError({
      message: 'El módulo de mascotas no está habilitado en este complejo',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: PetErrorCode.PETS_MODULE_DISABLED,
    });
  }

  /**
   * Mientras la administración no haya validado la ficha, el residente la
   * corrige él mismo: es SU registro y todavía no es parte del censo.
   *
   * Después ya no. Una ficha aprobada es la que la portería usa para
   * identificar al animal —foto incluida— y dejar que se edite por detrás
   * dejaría al censo diciendo una cosa y a la realidad otra. Para corregir algo
   * aprobado está la administración, que sí queda en la auditoría como quien lo
   * cambió.
   *
   * Retirar la mascota NO pasa por aquí a propósito: sacarla del censo cuando
   * se muda o fallece no daña ningún dato, y bloquearlo solo llenaría el censo
   * de animales que ya no viven ahí.
   */
  private assertFichaUnlocked(pet: Pet, currentUser: JwtAccessPayload): void {
    if (this.isStaff(currentUser)) return;
    if (EDITABLE_BY_RESIDENT.includes(pet.status)) return;

    throw new CustomError({
      message:
        'La ficha ya fue validada por la administración: pídele a ella el cambio',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: PetErrorCode.PET_LOCKED_AFTER_APPROVAL,
    });
  }

  private assertSpecialBreedCompliance(pet: Pet): void {
    if (!pet.isSpecialBreed) return;

    if (!pet.insurancePolicyNumber || !pet.insuranceExpiresAt) {
      throw new CustomError({
        message:
          'Las razas de manejo especial requieren póliza de responsabilidad civil extracontractual vigente',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INSURANCE_REQUIRED,
      });
    }

    if (new Date(pet.insuranceExpiresAt) < this.startOfDay(new Date())) {
      throw new CustomError({
        message: 'La póliza de responsabilidad civil está vencida',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_INSURANCE_EXPIRED,
      });
    }
  }

  private async assertMicrochipAvailable(
    complexId: string,
    microchipCode: string | undefined,
    ignorePetId?: string,
  ): Promise<void> {
    if (!microchipCode) return;

    const normalized = microchipCode.toUpperCase().replace(/\s/g, '');
    const existing = await this.petRepo.findOne({
      where: {
        complexId,
        microchipCode: normalized,
        deletedAt: IsNull(),
      },
    });

    if (existing && existing.id !== ignorePetId) {
      throw new CustomError({
        message: `El microchip "${normalized}" ya está registrado en este complejo`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: PetErrorCode.PET_MICROCHIP_DUPLICATE,
      });
    }
  }

  /**
   * De qué unidad es la mascota que se está registrando. El residente no puede
   * registrarle mascotas a otra unidad; la administración sí, porque hace el
   * censo por todo el conjunto.
   */
  private async resolveUnitContext(
    complexId: string,
    inputUnitId: string | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<{ unitId: string; residentId?: string }> {
    if (!this.isStaff(currentUser)) {
      const resident = await this.residentsService.findMyProfile(
        currentUser.sub,
        complexId,
      );

      if (inputUnitId && inputUnitId !== resident.unitId) {
        throw new CustomError({
          message: 'Solo puedes registrar mascotas en tu propia unidad',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GeneralErrorCode.FORBIDDEN,
        });
      }

      return { unitId: resident.unitId, residentId: resident.id };
    }

    if (!inputUnitId) {
      throw new CustomError({
        message: 'Debes indicar la unidad a la que pertenece la mascota',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const unit = await this.unitService.findById(inputUnitId, currentUser);
    if (unit.complexId !== complexId) {
      throw new CustomError({
        message: 'La unidad no pertenece al complejo indicado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PetErrorCode.PET_COMPLEX_MISMATCH,
      });
    }

    // Se asocia al residente principal si lo hay: sirve para saber a quién
    // reclamarle, pero la mascota es de la unidad, no de la persona.
    const residents =
      await this.residentsService.findActiveByUnitInternal(inputUnitId);
    const main = residents.find((r) => r.isMainResident) ?? residents[0];

    return { unitId: inputUnitId, residentId: main?.id };
  }

  private async resolveOwnUnitId(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<string> {
    const resident = await this.residentsService.findMyProfile(
      currentUser.sub,
      complexId,
    );
    return resident.unitId;
  }

  private async notifyUnit(
    pet: Pet,
    type: NotificationType,
    priority: NotificationPriority,
    title: string,
    body: string,
  ): Promise<void> {
    const residents = await this.residentsService.findActiveByUnitInternal(
      pet.unitId,
    );
    const userIds = residents.map((r) => r.userId).filter(Boolean);
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: pet.complexId,
      userIds,
      type,
      priority,
      title,
      body,
      entityId: pet.id,
      entityType: 'pet',
      metadata: {
        petId: pet.id,
        petName: pet.name,
        species: pet.species,
        unitId: pet.unitId,
      },
    });
  }

  private async notifyStaff(
    pet: Pet,
    type: NotificationType,
    title: string,
    body: string,
  ): Promise<void> {
    const userIds = await this.notificationsService.findUserIdsByRoles(
      pet.complexId,
      [ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL],
    );
    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId: pet.complexId,
      userIds,
      type,
      priority: NotificationPriority.NORMAL,
      title,
      body,
      entityId: pet.id,
      entityType: 'pet',
      isActionable: true,
      metadata: {
        petId: pet.id,
        petName: pet.name,
        unitId: pet.unitId,
        isSpecialBreed: pet.isSpecialBreed,
      },
    });
  }

  private startOfDay(date: Date): Date {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  private daysUntil(from: Date, to: Date): number {
    const target = this.startOfDay(to).getTime();
    const diff = target - from.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
  }

  private shouldRemind(days: number, leadDays: number): boolean {
    if (days < 0 || days > leadDays) return false;
    return REMINDER_THRESHOLDS.includes(days) || days === 0;
  }

  private async loadRelations(id: string): Promise<Pet> {
    return this.petRepo.findOne({
      where: { id },
      relations: ['unit', 'unit.building', 'resident', 'resident.user'],
    });
  }
}
