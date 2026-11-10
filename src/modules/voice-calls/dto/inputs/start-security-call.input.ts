import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID } from 'class-validator';

/** El residente llama a la portería de su conjunto desde RemoteLink. */
@InputType()
export class StartSecurityIntercomCallInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => String, {
    nullable: true,
    description: 'Unidad desde la que llama (si vive en varias del conjunto)',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
