import { HttpStatus } from '@nestjs/common';
import { Repository } from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { CustomError } from '../../shared/utils/errors.utils';
import { ResidentErrorCode } from '../../shared/constans/error-codes.constants';

type AccountLookup = Pick<User, 'id' | 'identity' | 'phoneNumber' | 'email'>;

/** Mismo criterio que los hooks de User: teléfono sin espacios, correo en minúscula. */
const normPhone = (v?: string | null) => (v ?? '').replace(/\s+/g, '');
const normEmail = (v?: string | null) => (v ?? '').trim().toLowerCase();

const mismatch = () =>
  new CustomError({
    // A propósito no dice dónde existe la cuenta: un conjunto no debe saber
    // que la persona vive en otro.
    message:
      'Ya existe una cuenta con estos datos, pero no coinciden entre sí. Verifica el documento, el teléfono y el correo.',
    statusCode: HttpStatus.CONFLICT,
    errorCode: ResidentErrorCode.ACCOUNT_DATA_MISMATCH,
  });

/**
 * Cuenta a la que se vincula un residente nuevo, o null para crear una.
 *
 * - Por documento: se vincula solo si además coincide el teléfono o el
 *   correo. El documento solo no basta (un error de digitación metería la
 *   cuenta de un desconocido en el conjunto).
 * - Sin cuenta con ese documento: por teléfono y luego por correo, como
 *   antes, salvo que esa cuenta tenga OTRO documento (es otra persona).
 */
export async function findAccountForNewResident(
  userRepo: Repository<User>,
  input: { identityNumber: string; phoneNumber: string; email: string },
): Promise<AccountLookup | null> {
  const identity = input.identityNumber.trim();
  const phone = normPhone(input.phoneNumber);
  const email = normEmail(input.email);
  const select: (keyof User)[] = ['id', 'identity', 'phoneNumber', 'email'];

  const byIdentity = identity
    ? await userRepo.findOne({ where: { identity }, select })
    : null;
  if (byIdentity) {
    const sameContact =
      normPhone(byIdentity.phoneNumber) === phone ||
      normEmail(byIdentity.email) === email;
    if (!sameContact) throw mismatch();
    return byIdentity;
  }

  const byContact =
    (await userRepo.findOne({ where: { phoneNumber: phone }, select })) ??
    (await userRepo.findOne({ where: { email }, select }));
  if (byContact?.identity && byContact.identity.trim() !== identity) {
    throw mismatch();
  }
  return byContact;
}
