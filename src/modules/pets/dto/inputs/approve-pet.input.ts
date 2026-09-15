import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class ApprovePetInput {
  @Field(() => String)
  @IsUUID()
  petId: string;

  @Field(() => String, {
    description: 'Notas internas de la administración',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
