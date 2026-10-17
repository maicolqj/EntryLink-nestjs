import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { BK } from '../../../core/infrastructure/cache/business-cache.constants';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  ComplexErrorCode,
  SubscriptionErrorCode,
} from '../../shared/constans/error-codes.constants';
import {
  ComplexReferralSummary,
  ReferredComplex,
} from '../dto/responses/complex-referral.response';
import { SetComplexReferrerInput } from '../dto/inputs/set-complex-referrer.input';
import {
  REFERRAL_REWARD_DAYS,
  generateReferralCode,
  normalizeReferralCode,
} from '../utils/referral-code';

const MAX_CODE_ATTEMPTS = 5;

/**
 * Código de recomendación de cada conjunto y quién llegó con él.
 *
 * El premio (cortesía REFERRAL) no vive aquí: lo otorga SubscriptionsService
 * al registrar el primer pago del conjunto recomendado.
 */
@Injectable()
export class ComplexReferralsService {
  private readonly logger = new Logger(ComplexReferralsService.name);

  constructor(
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    private readonly cacheService: CacheService,
  ) {}

  async getSummary(complexId: string): Promise<ComplexReferralSummary> {
    const complex = await this.findComplex(complexId);
    const code = await this.ensureCode(complex);

    const referredBy: ResidentialComplex | null = complex.referredByComplexId
      ? await this.complexRepo.findOne({
          where: { id: complex.referredByComplexId },
          select: ['id', 'name', 'status', 'createdAt'],
          withDeleted: true,
        })
      : null;
    const referrals = await this.complexRepo.find({
      where: { referredByComplexId: complex.id, deletedAt: IsNull() },
      select: ['id', 'name', 'status', 'createdAt', 'referralRewardedAt'],
      order: { createdAt: 'DESC' },
    });

    return {
      code,
      rewardDays: REFERRAL_REWARD_DAYS,
      referredBy: referredBy
        ? {
            ...this.toReferred(referredBy),
            rewardedAt: complex.referralRewardedAt ?? null,
          }
        : null,
      referrals: referrals.map((r) => this.toReferred(r)),
    };
  }

  /**
   * Para los que se registraron sin el código (o llegaron por fuera del
   * registro público). Una vez otorgada la cortesía ya no se cambia: el premio
   * quedó en la suscripción del que recomendó.
   */
  async setReferrer(
    input: SetComplexReferrerInput,
    userId: string,
  ): Promise<ComplexReferralSummary> {
    const complex = await this.findComplex(input.complexId);
    if (complex.referralRewardedAt) {
      throw new CustomError({
        message:
          'La cortesía por esta recomendación ya se otorgó: no se puede cambiar quién lo recomendó.',
        statusCode: HttpStatus.CONFLICT,
        errorCode: SubscriptionErrorCode.REFERRAL_ALREADY_REWARDED,
      });
    }

    const code = normalizeReferralCode(input.referralCode);
    let referrerId: string | null = null;
    if (code) {
      const referrer = await this.complexRepo.findOne({
        where: { referralCode: code, deletedAt: IsNull() },
        select: ['id'],
      });
      if (!referrer) {
        throw new CustomError({
          message: `El código de recomendación "${code}" no existe`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: SubscriptionErrorCode.REFERRAL_CODE_NOT_FOUND,
        });
      }
      if (referrer.id === complex.id) {
        throw new CustomError({
          message: 'Un conjunto no se puede recomendar a sí mismo',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: SubscriptionErrorCode.REFERRAL_SELF,
        });
      }
      referrerId = referrer.id;
    }

    await this.complexRepo.update(complex.id, {
      referredByComplexId: referrerId,
    });
    await this.cacheService.delete({ key: BK.complex.one(complex.id) });

    this.logger.log(
      `Recomendación de ${complex.id}: ${referrerId ?? 'ninguna'} (por ${userId})`,
    );
    return this.getSummary(complex.id);
  }

  /**
   * El código se genera la primera vez que se pide: así los conjuntos que ya
   * existían no necesitan un relleno en la migración. Un choque con el índice
   * único (o con otra petición que lo generó a la vez) se resuelve releyendo.
   */
  private async ensureCode(complex: ResidentialComplex): Promise<string> {
    if (complex.referralCode) return complex.referralCode;

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateReferralCode();
      try {
        const result = await this.complexRepo
          .createQueryBuilder()
          .update()
          .set({ referralCode: code })
          .where('id = :id', { id: complex.id })
          .andWhere('referral_code IS NULL')
          .execute();
        if (result.affected) return code;

        // Otra petición lo generó primero: vale el suyo.
        const current = await this.complexRepo.findOne({
          where: { id: complex.id },
          select: ['id', 'referralCode'],
        });
        if (current?.referralCode) return current.referralCode;
      } catch (err) {
        if (!this.isUniqueViolation(err)) throw err;
      }
    }

    throw new Error(
      `No se pudo generar el código de recomendación del complejo ${complex.id}`,
    );
  }

  private isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; driverError?: { code?: string } };
    return (e?.driverError?.code ?? e?.code) === '23505';
  }

  private toReferred(complex: ResidentialComplex): ReferredComplex {
    return {
      id: complex.id,
      name: complex.name,
      status: complex.status,
      registeredAt: complex.createdAt,
      rewardedAt: complex.referralRewardedAt ?? null,
    };
  }

  private async findComplex(complexId: string): Promise<ResidentialComplex> {
    const complex = await this.complexRepo.findOne({
      where: { id: complexId, deletedAt: IsNull() },
      select: [
        'id',
        'name',
        'referralCode',
        'referredByComplexId',
        'referralRewardedAt',
      ],
    });
    if (!complex) {
      throw new CustomError({
        message: `Complejo con ID "${complexId}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
      });
    }
    return complex;
  }
}
