import { InputType, Field } from '@nestjs/graphql';
import { IsBoolean, IsDate, IsOptional, IsUUID } from 'class-validator';

@InputType()
export class FilterSecurityAppExitsInput {
  @Field(() => String, { nullable: true, description: 'Solo este vigilante' })
  @IsOptional()
  @IsUUID()
  guardId?: string;

  @Field(() => Date, { nullable: true, description: 'Salidas desde esta hora' })
  @IsOptional()
  @IsDate()
  from?: Date;

  @Field(() => Date, { nullable: true, description: 'Salidas hasta esta hora' })
  @IsOptional()
  @IsDate()
  to?: Date;

  @Field(() => Boolean, {
    nullable: true,
    description: 'true = solo los vigilantes que siguen fuera de la app',
  })
  @IsOptional()
  @IsBoolean()
  onlyOpen?: boolean;
}
