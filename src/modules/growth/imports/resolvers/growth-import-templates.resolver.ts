import {
  Args,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { ValidPermissions as P } from '../../../permissions/enums/valid-permissions';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import {
  GrowthCreateImportTemplateInput,
  GrowthUpdateImportTemplateInput,
} from '../dto/inputs/import.inputs';
import { ImportMappingTemplate } from '../entities/import.entities';
import { GrowthImportTarget } from '../imports.enums';
import { ImportTemplatesService } from '../services/import-templates.service';

/**
 * Plantillas de mapeo personales y del equipo. Usarlas exige
 * IMPORT_GROWTH_DATA; cambiar las del equipo, además,
 * MANAGE_GROWTH_IMPORT_TEMPLATES (lo comprueba el servicio).
 */
@Resolver(() => ImportMappingTemplate)
export class GrowthImportTemplatesResolver {
  constructor(private readonly templates: ImportTemplatesService) {}

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Query(() => [ImportMappingTemplate], {
    name: 'growthImportTemplates',
    description: 'Las plantillas del equipo y las personales propias, vigentes',
  })
  growthImportTemplates(
    @Args('target', { type: () => GrowthImportTarget })
    target: GrowthImportTarget,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate[]> {
    return this.templates.list(target, actor);
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Mutation(() => ImportMappingTemplate, {
    name: 'growthCreateImportTemplate',
    description:
      'Crea una plantilla PERSONAL, o del equipo con MANAGE_GROWTH_IMPORT_TEMPLATES',
  })
  growthCreateImportTemplate(
    @Args('input') input: GrowthCreateImportTemplateInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    return this.templates.create(input, actor);
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Mutation(() => ImportMappingTemplate, {
    name: 'growthUpdateImportTemplate',
    description:
      'Renombra o cambia el mapeo de una plantilla que puedes editar',
  })
  growthUpdateImportTemplate(
    @Args('input') input: GrowthUpdateImportTemplateInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    return this.templates.update(input, actor);
  }

  @Auth({
    permissions: [P.IMPORT_GROWTH_DATA, P.MANAGE_GROWTH_IMPORT_TEMPLATES],
  })
  @Mutation(() => ImportMappingTemplate, {
    name: 'growthShareImportTemplate',
    description: 'Pasa una plantilla personal propia al equipo',
  })
  growthShareImportTemplate(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    return this.templates.share(id, actor);
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Mutation(() => ImportMappingTemplate, {
    name: 'growthArchiveImportTemplate',
    description: 'Archiva una plantilla que puedes editar (no se borra)',
  })
  growthArchiveImportTemplate(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    return this.templates.archive(id, reason, actor);
  }

  @ResolveField(() => Boolean, {
    description: 'Si quien consulta puede editarla o archivarla',
  })
  canEdit(
    @Parent() template: ImportMappingTemplate,
    @CurrentUser() actor: JwtAccessPayload,
  ): boolean {
    return this.templates.canEdit(template, actor);
  }
}
