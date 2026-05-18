import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SupervisorVisit } from '../entities/supervisor-visit.entity';
import { SupervisorVisitStatus } from '../enums/supervisor-visit-status.enum';
import { SupervisorCheckInInput } from '../dto/inputs/supervisor-checkin.input';
import { SupervisorCheckOutInput } from '../dto/inputs/supervisor-checkout.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../shared/utils/errors.utils';
import { SupervisorErrorCode } from '../../shared/constans/error-codes.constants';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import {
  UserComplexAssignment,
  AssignmentStatus,
} from '../../users/entities/user-complex-assignment.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { assertGpsWithinComplex } from '../../shared/utils/gps.utils';

@Injectable()
export class SupervisorVisitService {
  private readonly logger = new Logger(SupervisorVisitService.name);

  constructor(
    @InjectRepository(SupervisorVisit)
    private readonly visitRepo: Repository<SupervisorVisit>,

    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,

    @InjectRepository(UserComplexAssignment)
    private readonly assignmentRepo: Repository<UserComplexAssignment>,
  ) {}

  // ================================================================
  // CHECK-IN: el supervisor llega al complejo y registra su presencia
  // ================================================================

  async checkIn(
    input: SupervisorCheckInInput,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorVisit> {
    const { complexId, lat, lng } = input;
    const supervisorId = currentUser.sub;

    // 1. Verificar que el supervisor tiene asignación ACTIVA para este complejo.
    //    Si no está asignado → no puede visitar ni crear notas, sin importar el GPS.
    await this.assertSupervisorAssignment(supervisorId, complexId);

    // 2. Verificar que el complejo existe y cargar sus coordenadas
    const complex = await this.complexRepo.findOne({
      where: { id: complexId },
      select: ['id', 'name', 'latitude', 'longitude', 'gpsRadius'],
    });
    if (!complex) {
      throw new CustomError({
        message: `Complejo con ID "${complexId}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: SupervisorErrorCode.COMPLEX_NOT_FOUND_FOR_CHECKIN,
      });
    }

    // 3. Validar GPS: el supervisor debe estar físicamente en el complejo
    this.validateGps(complex, lat, lng);

    // 4. Verificar que no haya ya una visita ACTIVA para este supervisor en este complejo
    const existingActiveVisit = await this.visitRepo.findOne({
      where: { supervisorId, complexId, status: SupervisorVisitStatus.ACTIVE },
    });
    if (existingActiveVisit) {
      throw new CustomError({
        message: 'Ya tienes una visita activa en este complejo. Debes hacer check-out primero',
        statusCode: HttpStatus.CONFLICT,
        errorCode: SupervisorErrorCode.SUPERVISOR_VISIT_ALREADY_ACTIVE,
      });
    }

    // 5. Crear la visita
    const visit = this.visitRepo.create({
      supervisorId,
      complexId,
      checkInAt: new Date(),
      checkInLat: lat,
      checkInLng: lng,
      status: SupervisorVisitStatus.ACTIVE,
    });

    const saved = await this.visitRepo.save(visit);
    this.logger.log(
      `Check-in registrado: visitId=${saved.id} | supervisor=${supervisorId} | complejo=${complexId}`,
    );

    return this.loadRelations(saved.id);
  }

  // ================================================================
  // CHECK-OUT: el supervisor termina su visita al complejo
  // ================================================================

  async checkOut(
    input: SupervisorCheckOutInput,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorVisit> {
    const { complexId } = input;
    const supervisorId = currentUser.sub;

    const visit = await this.visitRepo.findOne({
      where: { supervisorId, complexId, status: SupervisorVisitStatus.ACTIVE },
    });

    if (!visit) {
      throw new CustomError({
        message: 'No tienes una visita activa en este complejo',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: SupervisorErrorCode.SUPERVISOR_VISIT_NOT_FOUND,
      });
    }

    await this.visitRepo.update(visit.id, {
      status: SupervisorVisitStatus.CLOSED,
      checkOutAt: new Date(),
    });

    this.logger.log(
      `Check-out registrado: visitId=${visit.id} | supervisor=${supervisorId} | complejo=${complexId}`,
    );

    return this.loadRelations(visit.id);
  }

  // ================================================================
  // VALIDAR VISITA ACTIVA PARA CREAR NOTAS (GPS re-validación)
  // Retorna el ID de la visita activa para adjuntarlo a la nota.
  // ================================================================

  async assertActiveVisitForNote(
    complexId: string,
    supervisorId: string,
    lat?: number,
    lng?: number,
  ): Promise<string> {
    // 1. Buscar visita activa — la asignación ya fue validada en el check-in
    const visit = await this.visitRepo.findOne({
      where: { supervisorId, complexId, status: SupervisorVisitStatus.ACTIVE },
    });

    if (!visit) {
      throw new CustomError({
        message: 'No tienes una visita activa en este complejo. Debes hacer check-in primero para crear notas',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: SupervisorErrorCode.SUPERVISOR_VISIT_REQUIRED_FOR_NOTE,
      });
    }

    // 2. Revalidar GPS si el complejo tiene coordenadas configuradas
    const complex = await this.complexRepo.findOne({
      where: { id: complexId },
      select: ['id', 'latitude', 'longitude', 'gpsRadius'],
    });

    if (complex?.latitude != null && complex?.longitude != null) {
      if (lat == null || lng == null) {
        throw new CustomError({
          message: 'Debes proporcionar tu ubicación GPS actual para crear notas en este complejo',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: SupervisorErrorCode.GPS_COORDINATES_REQUIRED,
        });
      }
      this.validateGps(complex, lat, lng);
    }

    return visit.id;
  }

  // ================================================================
  // COMPLEJOS AUTORIZADOS DEL SUPERVISOR
  // Lista los complejos a los que el supervisor tiene asignación activa.
  // ================================================================

  async findAssignedComplexes(supervisorId: string): Promise<ResidentialComplex[]> {
    const assignments = await this.assignmentRepo.find({
      where: {
        userId:   supervisorId,
        role:     ValidRoles.SUPERVISOR_ROL,
        status:   AssignmentStatus.ACTIVE,
      },
    });

    if (assignments.length === 0) return [];

    const complexIds = assignments.map((a) => a.complexId);

    return this.complexRepo
      .createQueryBuilder('c')
      .where('c.id IN (:...ids)', { ids: complexIds })
      .andWhere('c.deleted_at IS NULL')
      .select(['c.id', 'c.name', 'c.address', 'c.city', 'c.latitude', 'c.longitude', 'c.gpsRadius', 'c.logoUrl'])
      .getMany();
  }

  // ================================================================
  // CONSULTAS DE VISITAS
  // ================================================================

  async findMyVisits(
    supervisorId: string,
    status?: SupervisorVisitStatus,
  ): Promise<SupervisorVisit[]> {
    const where: any = { supervisorId };
    if (status) where.status = status;

    return this.visitRepo.find({
      where,
      relations: ['complex'],
      order: { checkInAt: 'DESC' },
      take: 50,
    });
  }

  async findActiveVisit(
    complexId: string,
    supervisorId: string,
  ): Promise<SupervisorVisit | null> {
    return this.visitRepo.findOne({
      where: { supervisorId, complexId, status: SupervisorVisitStatus.ACTIVE },
      relations: ['complex'],
    });
  }

  // ================================================================
  // VALIDACIÓN DE ASIGNACIÓN
  // ================================================================

  /**
   * Verifica que el supervisor tiene una asignación ACTIVA al complejo.
   * Sin esta asignación el supervisor no puede hacer check-in aunque esté presente físicamente.
   * La asignación la crea el COMPLEX_ROL al dar de alta al supervisor con createStaffMember.
   */
  private async assertSupervisorAssignment(
    supervisorId: string,
    complexId: string,
  ): Promise<void> {
    const assignment = await this.assignmentRepo.findOne({
      where: {
        userId:    supervisorId,
        complexId,
        role:      ValidRoles.SUPERVISOR_ROL,
        status:    AssignmentStatus.ACTIVE,
      },
    });

    if (!assignment) {
      throw new CustomError({
        message: 'No estás autorizado para visitar este complejo. Contacta al administrador del complejo para que te asigne.',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: SupervisorErrorCode.SUPERVISOR_NOT_ASSIGNED_TO_COMPLEX,
      });
    }
  }

  // ================================================================
  // GPS HELPERS — delegados a shared/utils/gps.utils.ts
  // ================================================================

  private validateGps(
    complex: Pick<ResidentialComplex, 'id' | 'latitude' | 'longitude' | 'gpsRadius'>,
    lat: number,
    lng: number,
  ): void {
    assertGpsWithinComplex(complex, lat, lng);
  }

  private async loadRelations(id: string): Promise<SupervisorVisit> {
    return this.visitRepo.findOne({
      where: { id },
      relations: ['supervisor', 'complex'],
    });
  }
}
