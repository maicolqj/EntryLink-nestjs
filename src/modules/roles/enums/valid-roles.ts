import { registerEnumType } from "@nestjs/graphql";

export enum ValidRoles {
    SUPER_ADMIN_ROL = 'SUPER_ADMIN_ROL',
    COMPILANCE_OFFICER_ROL = 'COMPILANCE_OFFICER_ROL',
    COMPLEX_ROL = 'COMPLEX_ROL',
    ACCOUNTANT_ROL = 'ACCOUNTANT_ROL',
    SUPERVISOR_ROL = 'SUPERVISOR_ROL',
    RESIDENT_ROL = 'RESIDENT_ROL',
    SECURITY_ROL = 'SECURITY_ROL',
}

registerEnumType(ValidRoles, {
    name: 'ValidRoles',
    description: 'Roles de la paltaforma'
});