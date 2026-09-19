import { Field, ID, ObjectType } from '@nestjs/graphql';

/** Una descarga de datos, tal como quedó en la auditoría. */
@ObjectType({ description: 'Descarga de datos realizada en el complejo' })
export class DataExportHistoryEntry {
  @Field(() => ID)
  id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => String, { nullable: true })
  performedByName: string | null;

  @Field(() => String, { description: 'module | backup' })
  kind: string;

  @Field(() => [String])
  modules: string[];

  @Field(() => String, { nullable: true })
  from: string | null;

  @Field(() => String, { nullable: true })
  to: string | null;
}
