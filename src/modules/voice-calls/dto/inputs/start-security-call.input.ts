import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * El residente llama a portería desde RemoteLink. Si el conjunto tiene varias
 * porterías (`securityPosts`), elige a cuál y solo timbra en esa.
 */
@InputType()
export class StartSecurityIntercomCallInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => String, {
    nullable: true,
    description:
      'Portería a la que llama. Obligatoria si el conjunto tiene más de una',
  })
  @IsOptional()
  @IsUUID()
  securityPostId?: string;

  @Field(() => String, {
    nullable: true,
    description: 'Unidad desde la que llama (si vive en varias del conjunto)',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
