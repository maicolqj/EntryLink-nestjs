import { Resolver, Query, Mutation, Args, ResolveField, Parent } from '@nestjs/graphql';
import { PqrfStatus } from '../enums/pqrf-status.enum';

import { Pqrf }        from '../entities/pqrf.entity';
import { PqrfService } from '../services/pqrf.service';

import { CreatePqrfInput } from '../dto/inputs/create-pqrf.input';
import { FilterPqrfInput } from '../dto/inputs/filter-pqrf.input';
import { PaginatedPqrfResponse } from '../dto/responses/paginated-pqrf.response';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

/**
 * Quien puede tocar la bandeja de radicados.
 *
 * Incluye RESIDENT_ROL a propósito: el consejero entra a la app como residente
 * y su COUNCIL_ROL viaja en el JWT, que se emitió al iniciar sesión. A quien
 * nombran consejero hoy, el token todavía no le trae el rol, y este decorador lo
 * dejaría fuera de su propia bandeja hasta que vuelva a entrar. El corte real
 * —qué puede leer y qué puede marcar cada uno— lo hace el servicio contra la
 * base de datos y el destinatario del radicado, no esta lista.
 */
const INBOX_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.COUNCIL_ROL,
  ValidRoles.RESIDENT_ROL,
];

@Resolver(() => Pqrf)
export class PqrfResolver {

  constructor(private readonly pqrfService: PqrfService) {}

  /**
   * ¿Esta persona puede marcar el radicado como resuelto?
   *
   * Lo decide el servidor y no la UI: depende de a qué instancia se dirigió el
   * radicado y de si quien mira pertenece a ella, algo que el cliente no puede
   * saber sin replicar la regla. Quien lo radicó nunca puede.
   */
  @ResolveField(() => Boolean, { description: 'Quien consulta puede marcarlo como resuelto' })
  async viewerCanResolve(
    @Parent() pqrf: Pqrf,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    if (pqrf.status === PqrfStatus.RESUELTO) return false;
    if (this.hasResolved(pqrf, currentUser)) return false;

    return (await this.pqrfService.instanceOf(pqrf, currentUser)) !== null;
  }

  /** ¿Ya marcó su parte? Sirve para explicar por qué no hay botón. */
  @ResolveField(() => Boolean, { description: 'Quien consulta ya marcó su parte' })
  viewerHasResolved(
    @Parent() pqrf: Pqrf,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): boolean {
    return this.hasResolved(pqrf, currentUser);
  }

  private hasResolved(pqrf: Pqrf, currentUser: JwtAccessPayload): boolean {
    return (pqrf.acknowledgements ?? []).some(
      ack => ack.userId === currentUser.sub && !!ack.resolvedAt,
    );
  }

  @Mutation(() => Pqrf, { name: 'createPqrf', description: 'Radica un PQRF' })
  @Auth({
    roles: [ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.CREATE_PQRF],
  })
  create(
    @Args('input') input: CreatePqrfInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pqrf> {
    return this.pqrfService.create(input, currentUser);
  }

  /** Bandeja de la instancia: solo lo que le fue dirigido. */
  @Query(() => PaginatedPqrfResponse, { name: 'pqrfRequests' })
  @Auth({
    roles: INBOX_ROLES,
    permissions: [ValidPermissions.VIEW_PQRF],
  })
  findByComplex(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterPqrfInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedPqrfResponse> {
    return this.pqrfService.findByComplex(complexId, pagination, filters, currentUser);
  }

  /** Los radicados del propio residente. */
  @Query(() => PaginatedPqrfResponse, { name: 'myPqrfRequests' })
  @Auth({
    roles: [ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.CREATE_PQRF],
  })
  findMine(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterPqrfInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedPqrfResponse> {
    return this.pqrfService.findMine(complexId, pagination, filters, currentUser);
  }

  /**
   * Deja constancia de que el destinatario abrió el radicado y lo pasa a EN
   * TRÁMITE. La ficha la llama al montarse: que alguien lo haya leído es un
   * hecho, no algo que quien atiende deba reportar a mano.
   */
  @Mutation(() => Pqrf, { name: 'openPqrf', description: 'Marca el radicado como abierto por quien lo atiende' })
  @Auth({
    roles: INBOX_ROLES,
    permissions: [ValidPermissions.VIEW_PQRF],
  })
  open(
    @Args('pqrfId') pqrfId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pqrf> {
    return this.pqrfService.open(pqrfId, currentUser);
  }

  /** Solo pasa a RESUELTO cuando TODOS los destinatarios lo marcan. */
  @Mutation(() => Pqrf, { name: 'resolvePqrf', description: 'Marca el radicado como resuelto por quien lo atiende' })
  @Auth({
    roles: INBOX_ROLES,
    permissions: [ValidPermissions.VIEW_PQRF],
  })
  resolve(
    @Args('pqrfId') pqrfId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pqrf> {
    return this.pqrfService.markResolved(pqrfId, currentUser);
  }

  @Query(() => Pqrf, { name: 'pqrfRequest' })
  @Auth({
    roles: [...INBOX_ROLES, ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.VIEW_PQRF],
  })
  findOne(
    @Args('pqrfId') pqrfId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pqrf> {
    return this.pqrfService.findById(pqrfId, currentUser);
  }
}
