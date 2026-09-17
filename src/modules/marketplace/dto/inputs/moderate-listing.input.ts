import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class ModerateListingInput {
  @Field(() => String)
  @IsUUID()
  listingId: string;

  /**
   * Obligatorio al rechazar y al retirar: el servicio lo exige. Un aviso que
   * desaparece sin explicación es la queja que llega después a la
   * administración, y quien lo publicó no tiene cómo corregirlo.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
