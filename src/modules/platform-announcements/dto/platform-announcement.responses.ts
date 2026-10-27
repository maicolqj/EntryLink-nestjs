import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { PlatformAnnouncement } from '../entities/platform-announcement.entity';
import { PaginationReponse } from '../../shared/dto/responses/pagination-object.response';

@ObjectType()
export class AnnouncementTargetComplex {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;
}

/** Lo que recibiría el comunicado si se enviara ahora. */
@ObjectType()
export class AnnouncementTargetPreview {
  @Field(() => Int)
  complexesCount: number;

  /** Cuántos de esos conjuntos tienen un correo registrado. */
  @Field(() => Int)
  withEmailCount: number;

  @Field(() => [AnnouncementTargetComplex])
  complexes: AnnouncementTargetComplex[];
}

/**
 * Un conjunto que recibió el comunicado. El correo es el registrado HOY en la
 * ficha: no se guarda a qué dirección salió cada envío.
 */
@ObjectType()
export class AnnouncementRecipientComplex {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  email: string | null;

  /** Avisos creados para este conjunto (administración y/o residentes). */
  @Field(() => Int)
  noticesCount: number;

  /** De esos avisos, cuántos ya se leyeron. */
  @Field(() => Int)
  readCount: number;
}

@ObjectType()
export class PlatformAnnouncementPaginatedResult {
  @Field(() => [PlatformAnnouncement])
  items: PlatformAnnouncement[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

/** Cuántos hay en cada carpeta para quien consulta. */
@ObjectType()
export class AnnouncementFolderCounts {
  @Field(() => Int)
  sent: number;

  @Field(() => Int)
  starred: number;

  @Field(() => Int)
  archived: number;

  @Field(() => Int)
  trash: number;
}

/** Resultado de una acción sobre varios comunicados a la vez. */
@ObjectType()
export class AnnouncementBulkResult {
  /** Cuántos comunicados cambiaron. */
  @Field(() => Int)
  affected: number;

  /** Avisos retirados de las bandejas de los conjuntos (al eliminar). */
  @Field(() => Int, { defaultValue: 0 })
  noticesRemoved: number;
}
