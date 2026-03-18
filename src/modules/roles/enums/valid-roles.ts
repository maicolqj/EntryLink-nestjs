import { registerEnumType } from "@nestjs/graphql";

export enum ValidRoles {
    SUPER_ADMIN_ROL = 'SUPER_ADMIN_ROL', //* Administrador del sistema (control total)
    COMPILANCE_OFFICER_ROL = 'COMPILANCE_OFFICER_ROL', //* administrativo (trabaja para el sistema)
    COMPLEX_ROL = 'COMPLEX_ROL', //* Administrador del complejo residencial
    ACCOUNTANT_ROL = 'ACCOUNTANT_ROL', //* Contador del complejo Residencial 
    SUPERVISOR_ROL = 'SUPERVISOR_ROL', //* Supervisor de seguridad
    SECURITY_ROL = 'SECURITY_ROL', //* Guarda de seguridad del complejo
    RESIDENT_ROL = 'RESIDENT_ROL', //* Recidentes del complejo
}

registerEnumType(ValidRoles, {
    name: 'ValidRoles',
    description: 'Roles de la paltaforma'
});