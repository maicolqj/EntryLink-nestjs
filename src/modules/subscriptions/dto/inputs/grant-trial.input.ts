import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType({ description: 'Otorgar la prueba gratis de 30 días' })
export class GrantTrialInput {
  @Field(() => ID)
  @IsUUID()
  complexId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
