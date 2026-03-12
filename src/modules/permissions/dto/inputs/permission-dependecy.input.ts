import { Field, InputType, Int, ObjectType } from "@nestjs/graphql";
import { GraphQLJSON } from "graphql-type-json";

@InputType()
export class PermissionDependencyInput {

  @Field(() => String, { description: 'ID of the dependency permission' })
  id: string;

  // @ApiProperty({
  //   description: 'Name of the dependency permission',
  //   type: String,
  //   example: 'LEER_METODOS_DE_PAGO',
  // })
  // @Field(() => String, { description: 'Name of the dependency permission' })
  // name: string;

  // @ApiProperty({
  //   description: 'Description of the dependency permission',
  //   type: String,
  //   example: 'Permite leer métodos de pago',
  // })
  // @Field(() => String, { description: 'Description of the dependency permission' })
  // description: string;
}