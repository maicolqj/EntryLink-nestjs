import { InputType, Field } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';

@InputType()
export class SupervisorCheckOutInput {

  @Field(() => String, { description: 'ID del complejo del que el supervisor hace check-out' })
  @IsUUID()
  complexId: string;
}
