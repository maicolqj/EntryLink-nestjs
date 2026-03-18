import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

@InputType()
export class ConfirmDeliveryInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  packageId: string;

  /** Nombre de la persona que retira (puede ser familiar/empleado) */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  receivedByName?: string;

  /** Documento de identidad de quien retira */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  receivedByIdentity?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
