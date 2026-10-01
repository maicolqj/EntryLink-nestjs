import { Field, ID, InputType } from '@nestjs/graphql';
import { IsDate, IsString, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

@InputType({ description: 'Corregir a mano el vencimiento vigente' })
export class AdjustSubscriptionInput {
  @Field(() => ID)
  @IsUUID()
  complexId: string;

  @Field(() => Date)
  @Type(() => Date)
  @IsDate()
  endsAt: Date;

  @Field(() => String, {
    description: 'Motivo del ajuste (queda en el historial)',
  })
  @IsString()
  @MaxLength(1000)
  reason: string;
}
