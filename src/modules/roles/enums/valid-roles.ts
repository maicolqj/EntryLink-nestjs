import { registerEnumType } from "@nestjs/graphql";

export enum ValidRoles {
    SUPER_ADMIN_ROL = 'SUPER_ADMIN_ROL',
    COMPILANCE_OFFICER_ROL = 'COMPILANCE_OFFICER_ROL',
    COMPLEX_ROL = 'COMPLEX_ROL',
    ACCOUNTANT_ROL = 'ACCOUNTANT_ROL',
    SUPERVISOR_ROL = 'SUPERVISOR_ROL',
    RESIDENT_ROL = 'RESIDENT_ROL',
    SECURITY_ROL = 'SECURITY_ROL',
    /**
     * Miembro del consejo de administración. Es un rol ADICIONAL: quien lo tiene
     * sigue siendo residente y entra a la app como tal. Existe para que el
     * consejo pueda recibir lo que se le dirige —un PQRF con una queja del
     * propio administrador, por ejemplo— sin que eso pase por la administración.
     */
    COUNCIL_ROL = 'COUNCIL_ROL',
}

registerEnumType(ValidRoles, {
    name: 'ValidRoles',
    description: 'Roles de la paltaforma'
});