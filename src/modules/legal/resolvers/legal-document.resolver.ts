import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { Logger } from '@nestjs/common';

import { LegalDocument } from '../entities/legal-document.entity';
import { CreateLegalDocumentInput } from '../dto/inputs/create-legal-document.input';
import { UpdateLegalDocumentInput } from '../dto/inputs/update-legal-document.input';
import { LegalDocumentService } from '../services/legal-document.service';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ComplexEngagement } from '../../residential-complex/enums/complex-engagement.enum';

@Resolver(() => LegalDocument)
export class LegalDocumentResolver {
  private readonly logger = new Logger(LegalDocumentResolver.name);

  constructor(private readonly service: LegalDocumentService) {}

  // ── Consultas (SUPER_ADMIN) ──────────────────────────────────────

  @Query(() => [LegalDocument], {
    name: 'legalDocumentsAdmin',
    description:
      'Todos los documentos legales (incluidos no publicados). Solo SUPER_ADMIN.',
  })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
  })
  legalDocumentsAdmin(): Promise<LegalDocument[]> {
    return this.service.findAllAdmin();
  }

  @Query(() => [LegalDocument], {
    name: 'complexLegalDocuments',
    description:
      'Documentos legales dirigidos a complejos registrados (audience COMPLEX, publicados). ' +
      'El complejo recibe los de su vinculación (piloto: acuerdo de piloto; comercial: Anexo B2B) ' +
      'más los que van a todos. La plataforma puede filtrar con `engagement`.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL] })
  complexLegalDocuments(
    @CurrentUser() payload: JwtAccessPayload,
    @Args('engagement', { type: () => ComplexEngagement, nullable: true })
    engagement?: ComplexEngagement,
  ): Promise<LegalDocument[]> {
    // La cuenta del complejo inicia sesión con sub = complex.id.
    if (payload.roles?.includes(ValidRoles.SUPER_ADMIN_ROL)) {
      return this.service.findComplexDocuments({ engagement });
    }
    const complexId =
      payload.complexId ??
      (payload.entityType === 'complex' ? payload.sub : undefined);
    // Sin conjunto identificable se tratan como comerciales: nunca se le
    // entrega a nadie el documento equivocado por no saber quién es.
    return this.service.findComplexDocuments(
      complexId ? { complexId } : { engagement: ComplexEngagement.COMMERCIAL },
    );
  }

  // ── Mutaciones (SUPER_ADMIN) ─────────────────────────────────────

  @Mutation(() => LegalDocument, {
    name: 'createLegalDocument',
    description: 'Crea un documento legal. Solo SUPER_ADMIN.',
  })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
  })
  createLegalDocument(
    @Args('input') input: CreateLegalDocumentInput,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<LegalDocument> {
    return this.service.create(input, payload.sub);
  }

  @Mutation(() => LegalDocument, {
    name: 'updateLegalDocument',
    description:
      'Actualiza metadatos/contenido/publicación de un documento legal. Solo SUPER_ADMIN.',
  })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
  })
  updateLegalDocument(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateLegalDocumentInput,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<LegalDocument> {
    return this.service.update(id, input, payload.sub);
  }

  @Mutation(() => Boolean, {
    name: 'deleteLegalDocument',
    description: 'Elimina un documento legal. Solo SUPER_ADMIN.',
  })
  @Auth({
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPILANCE_OFFICER_ROL],
  })
  deleteLegalDocument(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.service.remove(id);
  }
}
