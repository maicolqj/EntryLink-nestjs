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

  @Field(() => [AnnouncementTargetComplex])
  complexes: AnnouncementTargetComplex[];
}

@ObjectType()
export class PlatformAnnouncementPaginatedResult {
  @Field(() => [PlatformAnnouncement])
  items: PlatformAnnouncement[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
