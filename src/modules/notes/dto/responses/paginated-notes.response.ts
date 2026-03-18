import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Note } from '../../entities/note.entity';

@ObjectType()
export class PaginatedNotesResponse {

  @Field(() => [Note])
  items: Note[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
