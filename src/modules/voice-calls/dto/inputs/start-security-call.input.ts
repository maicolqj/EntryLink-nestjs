import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * El residente llama a UNA portería de su conjunto desde RemoteLink. Igual que
 * portería elige al residente: si hay varias porterías, el residente escoge a
 * cuál (lista de `intercomSecurityContacts`) y solo esa timbra.
 */
@InputType()
export class StartSecurityIntercomCallInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => String, {
    description: 'Portería a la que llama (cuenta de vigilante)',
  })
  @IsUUID()
  securityUserId: string;

  @Field(() => String, {
    nullable: true,
    description: 'Unidad desde la que llama (si vive en varias del conjunto)',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
