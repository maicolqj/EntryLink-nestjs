import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class TriggerPanicAlertResult {
  @Field()
  success: boolean;
}
