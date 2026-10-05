import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import {
  ComplexSchedule,
  ComplexScheduleSlot,
} from '../entities/complex-schedule.entity';
import {
  CreateComplexScheduleInput,
  UpdateComplexScheduleInput,
} from '../dto/complex-info.inputs';
import { ComplexInfoAccessService } from './complex-info-access.service';
import { normalizeSlots } from '../utils/schedule-slots';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexInfoErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

function byOrder(a: ComplexSchedule, b: ComplexSchedule): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name, 'es');
}

/** Horarios de "Mi Conjunto": atención, shut de basuras, reciclaje… */
@Injectable()
export class ComplexSchedulesService {
  constructor(
    @InjectRepository(ComplexSchedule)
    private readonly scheduleRepo: Repository<ComplexSchedule>,
    private readonly access: ComplexInfoAccessService,
  ) {}

  async listAdmin(
    complexId: string,
    user: JwtAccessPayload,
  ): Promise<ComplexSchedule[]> {
    await this.access.assertAdmin(complexId, user);
    const schedules = await this.scheduleRepo.find({
      where: { complexId, deletedAt: IsNull() },
    });
    return schedules.sort(byOrder);
  }

  /** Lo que ve el residente: solo los activos. Sin validar acceso: lo hace quien llama. */
  async listVisible(complexId: string): Promise<ComplexSchedule[]> {
    const schedules = await this.scheduleRepo.find({
      where: { complexId, isActive: true, deletedAt: IsNull() },
    });
    return schedules.sort(byOrder);
  }

  async create(
    input: CreateComplexScheduleInput,
    user: JwtAccessPayload,
  ): Promise<ComplexSchedule> {
    await this.access.assertAdmin(input.complexId, user);
    const schedule = this.scheduleRepo.create({
      ...input,
      slots: this.validSlots(input.slots),
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });
    return this.scheduleRepo.save(schedule);
  }

  async update(
    id: string,
    input: UpdateComplexScheduleInput,
    user: JwtAccessPayload,
  ): Promise<ComplexSchedule> {
    const schedule = await this.findOrFail(id);
    await this.access.assertAdmin(schedule.complexId, user);
    Object.assign(schedule, {
      ...input,
      ...(input.slots ? { slots: this.validSlots(input.slots) } : {}),
    });
    return this.scheduleRepo.save(schedule);
  }

  async remove(id: string, user: JwtAccessPayload): Promise<boolean> {
    const schedule = await this.findOrFail(id);
    await this.access.assertAdmin(schedule.complexId, user);
    await this.scheduleRepo.softDelete(schedule.id);
    return true;
  }

  private validSlots(slots: ComplexScheduleSlot[]): ComplexScheduleSlot[] {
    const result = normalizeSlots(slots);
    if ('error' in result) {
      throw new CustomError({
        message: result.error,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ComplexInfoErrorCode.COMPLEX_SCHEDULE_INVALID_SLOTS,
      });
    }
    return result.slots;
  }

  private async findOrFail(id: string): Promise<ComplexSchedule> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!schedule) {
      throw new CustomError({
        message: 'Horario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexInfoErrorCode.COMPLEX_SCHEDULE_NOT_FOUND,
      });
    }
    return schedule;
  }
}
