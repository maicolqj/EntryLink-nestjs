import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Roles con los que sale una sesión abierta por un canal de residente
 * (WhatsApp entrante, OTP, código de sistema, clave de acceso del dispositivo,
 * aprobación desde otro equipo).
 *
 * Existe porque una misma cuenta puede ser residente y administrador a la vez:
 * quien administra el conjunto también vive en él. Sin este recorte, el JWT
 * salía con TODOS los roles del usuario (`TokenService.extractRoles`), así que
 * enviar un WhatsApp entregaba una sesión de SUPER_ADMIN sin escribir la
 * contraseña. La posesión del teléfono pasaba a valer tanto como la credencial.
 *
 * Con el recorte, esa cuenta entra por WhatsApp como residente —que es lo que
 * el canal probó— y accede al panel administrativo solo por email + contraseña,
 * que sigue emitiendo el token completo.
 *
 * COUNCIL_ROL va incluido porque es un rol ADICIONAL del residente, no un
 * privilegio administrativo: sin él, un consejero perdería su bandeja al entrar
 * por WhatsApp.
 */
export const RESIDENT_SESSION_ROLES: readonly ValidRoles[] = [
  ValidRoles.RESIDENT_ROL,
  ValidRoles.COUNCIL_ROL,
];
