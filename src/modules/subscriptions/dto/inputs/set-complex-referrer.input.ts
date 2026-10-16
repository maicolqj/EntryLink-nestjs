import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType({
  description:
    'Asigna (o quita) el conjunto que recomendó a otro, para los que se registraron sin el código',
})
export class SetComplexReferrerInput {
  @Field(() => ID)
  @IsUUID()
  complexId: string;

  @Field(() => String, {
    nullable: true,
    description: 'Código del conjunto que lo recomendó. Vacío = quitarlo.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string | null;
}
