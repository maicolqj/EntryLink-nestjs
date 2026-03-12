import { registerEnumType } from '@nestjs/graphql';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║               PERMISOS VÁLIDOS DEL SISTEMA                   ║
 * ╠══════════════════════════════════════════════════════════════╣
 */

export enum ValidPermissions {

  // ═══════════════════════════════════════════════════════
  // staf
  // ═══════════════════════════════════════════════════════

  /** Ver lista de usuarios y perfil básico. ➜ Nivel: [LOW] | Requiere: [] */
  VIEW_USERS                = 'VIEW_USERS',

  /** Ver datos sensibles: email, teléfono, dirección. ➜ Nivel: [CRITICAL] | Requiere: [VIEW_USERS] */
  VIEW_SENSITIVE_USER_DATA  = 'VIEW_SENSITIVE_USER_DATA',

  /** Crear nuevos usuarios en el sistema. ➜ Nivel: [MEDIUM] | Requiere: [VIEW_USERS] */
  CREATE_USER               = 'CREATE_USER',

  /** Editar datos de un usuario. ➜ Nivel: [MEDIUM] | Requiere: [VIEW_USERS] */
  EDIT_USER                 = 'EDIT_USER',

  /** Bloquear/desbloquear cuenta de usuario. ➜ Nivel: [HIGH] | Requiere: [VIEW_USERS] */
  BLOCK_USER                = 'BLOCK_USER',

  /** Eliminar usuarios del sistema. ➜ Nivel: [CRITICAL] | Requiere: [VIEW_USERS] */
  DELETE_USER               = 'DELETE_USER',

  /** CONTROL TOTAL USUARIOS. ➜ Nivel: [CRITICAL] | Requiere: [VIEW_USERS, DELETE_USER, BLOCK_USER] */
  MANAGE_USERS              = 'MANAGE_USERS',

  // ═══════════════════════════════════════════════════════
  // ROLES Y PERMISOS
  // ═══════════════════════════════════════════════════════

  /** Ver roles disponibles. ➜ Nivel: [LOW] | Requiere: [] */
  VIEW_ROLES                = 'VIEW_ROLES',

  /** Crear nuevos roles. ➜ Nivel: [MEDIUM] | Requiere: [VIEW_ROLES] */
  CREATE_ROLE               = 'CREATE_ROLE',

  /** Editar roles existentes. ➜ Nivel: [HIGH] | Requiere: [VIEW_ROLES] */
  EDIT_ROLE                 = 'EDIT_ROLE',

  /** Asignar/remover permisos en un rol. ➜ Nivel: [CRITICAL] | Requiere: [EDIT_ROLE] */
  ASSIGN_PERMISSIONS        = 'ASSIGN_PERMISSIONS',

  /** Eliminar roles. ➜ Nivel: [CRITICAL] | Requiere: [VIEW_ROLES] */
  DELETE_ROLE               = 'DELETE_ROLE',

  /** Control total sobre roles y permisos. ➜ Nivel: [CRITICAL] | Requiere: [VIEW_ROLES, ASSIGN_PERMISSIONS] */
  MANAGE_ROLES              = 'MANAGE_ROLES',

  // ═══════════════════════════════════════════════════════
  // RESIDENTS
  // ═══════════════════════════════════════════════════════

  /** Ver lista de RESIDENTES. ➜ Nivel: [LOW] | Requiere: [] */
  VIEW_RESIDENTS             = 'VIEW_RECIDENTS',

  /** Crear nuevos RESIDENTES. ➜ Nivel: [MEDIUM] | Requiere: [VIEW_RECIDENTS] */
  CREATE_RESIDENTS            = 'CREATE_RECIDENTS',

  /** Editar datos de RESIDENTES. ➜ Nivel: [MEDIUM] | Requiere: [VIEW_RECIDENTS] */
  EDIT_RESIDENTS              = 'EDIT_RECIDENTS',

  /** Ver ubicación en tiempo real. ➜ Nivel: [HIGH] | Requiere: [VIEW_RECIDENTS] */
  VIEW_RECIDENTS_LOCATION      = 'VIEW_RECIDENTS_LOCATION',

  /** Bloquear/desbloquear conductor. ➜ Nivel: [HIGH] | Requiere: [VIEW_RECIDENTS] */
  BLOCK_RESIDENTS             = 'BLOCK_RECIDENTS',

  /** Eliminar RESIDENTES. ➜ Nivel: [CRITICAL] | Requiere: [VIEW_RECIDENTS] */
  DELETE_RESIDENTS            = 'DELETE_RECIDENTS',

  /** Control total sobre RESIDENTES. ➜ Nivel: [HIGH] | Requiere: [VIEW_RECIDENTS, BLOCK_RECIDENTS] */
  MANAGE_RESIDENTS         = 'MANAGE_RECIDENTS',

  /** Aprobar solicitudes de residencia. ➜ Nivel: [HIGH] | Requiere: [VIEW_RECIDENTS] */
  APPROVE_RESIDENT         = 'APPROVE_RESIDENT',

  /** Rechazar solicitudes de residencia. ➜ Nivel: [HIGH] | Requiere: [VIEW_RECIDENTS] */
  REJECT_RESIDENT          = 'REJECT_RESIDENT',

  // ═══════════════════════════════════════════════════════
  // PACKAGES
  // ═══════════════════════════════════════════════════════

  /** Ver todos los pedidos del sistema. ➜ Nivel: [LOW] | Requiere: [] */
  VIEW_PACKAGES               = 'VIEW_PACKAGES',

  /** Crear pedidos. ➜ Nivel: [LOW] | Requiere: [] */
  CREATE_PACKAGE              = 'CREATE_PACKAGE',

  /** Editar pedidos existentes. ➜ Nivel: [MEDIUM] | Requiere: [VIEW_PACKAGES] */
  EDIT_PACKAGE                = 'EDIT_PACKAGE',

  /** Asignar conductor a un pedido. ➜ Nivel: [MEDIUM] | Requiere: [VIEW_PACKAGES, VIEW_DRIVERS] */
  // ASSIGN_DRIVER_TO_PACKAGE    = 'ASSIGN_DRIVER_TO_PACKAGE',

  /** Exportar datos de pedidos. ➜ Nivel: [MEDIUM] | Requiere: [VIEW_PACKAGES] */
  EXPORT_PACKAGES             = 'EXPORT_PACKAGES',

  /** Cancelar pedidos. ➜ Nivel: [HIGH] | Requiere: [VIEW_PACKAGES] */
  // CANCEL_PACKAGE              = 'CANCEL_PACKAGE',

  /** Control total sobre pedidos. ➜ Nivel: [HIGH] | Requiere: [VIEW_PACKAGES, CANCEL_PACKAGE] */
  MANAGE_PACKAGES             = 'MANAGE_PACKAGES',

  // ═══════════════════════════════════════════════════════
  // RECIDENCIAS Y PRODUCTOS
  // ═══════════════════════════════════════════════════════

  /** Ver RECIDENCIAS. ➜ Nivel: [LOW] | Requiere: [] */
  VIEW_RESIDENCES               = 'VIEW_RESIDENCES',

  /** Crear RECIDENCIAS. ➜ Nivel: [MEDIUM] | Requiere: [] */
  CREATE_RESIDENCE              = 'CREATE_RESIDENCE',

  /** Editar RECIDENCIAS. ➜ Nivel: [MEDIUM] | Requiere: [VIEW_RESIDENCES] */
  EDIT_RESIDENCE                = 'EDIT_RESIDENCE',

  /** Activar/desactivar tienda. ➜ Nivel: [HIGH] | Requiere: [VIEW_RESIDENCES] */
  TOGGLE_RESIDENCE_STATUS       = 'TOGGLE_RESIDENCE_STATUS',

  /** Eliminar RECIDENCIAS. ➜ Nivel: [CRITICAL] | Requiere: [VIEW_RESIDENCES] */
  DELETE_RESIDENCE              = 'DELETE_RESIDENCE',

  /** Control total sobre RECIDENCIAS. ➜ Nivel: [HIGH] | Requiere: [VIEW_RESIDENCES] */
  MANAGE_RESIDENCES             = 'MANAGE_RESIDENCES',

  /** Ver catálogo de productos. ➜ Nivel: [LOW] | Requiere: [] */
  VIEW_PRODUCTS             = 'VIEW_PRODUCTS',

  /** Gestionar productos (Crear, Editar, Borrar). ➜ Nivel: [MEDIUM] | Requiere: [VIEW_PRODUCTS] */
  MANAGE_PRODUCTS           = 'MANAGE_PRODUCTS',

  // ═══════════════════════════════════════════════════════
  // REPORTES Y CONFIGURACIÓN
  // ═══════════════════════════════════════════════════════

  /** Ver reportes y analíticas. ➜ Nivel: [MEDIUM] | Requiere: [] */
  VIEW_REPORTS              = 'VIEW_REPORTS',

  /** Exportar reportes a Excel/PDF. ➜ Nivel: [HIGH] | Requiere: [VIEW_REPORTS] */
  EXPORT_REPORTS            = 'EXPORT_REPORTS',

  /** Ver configuración del sistema. ➜ Nivel: [LOW] | Requiere: [] */
  VIEW_SETTINGS             = 'VIEW_SETTINGS',

  /** Editar configuración del sistema. ➜ Nivel: [CRITICAL] | Requiere: [VIEW_SETTINGS] */
  EDIT_SETTINGS             = 'EDIT_SETTINGS',

  /** Ver notificaciones del sistema. ➜ Nivel: [LOW] | Requiere: [] */
  VIEW_NOTIFICATIONS        = 'VIEW_NOTIFICATIONS',

  /** Enviar notificaciones masivas. ➜ Nivel: [HIGH] | Requiere: [VIEW_NOTIFICATIONS] */
  SEND_NOTIFICATIONS        = 'SEND_NOTIFICATIONS',

  // ═══════════════════════════════════════════════════════
  // VISITANTES Y VISITAS
  // ═══════════════════════════════════════════════════════

  /** Ver lista de visitantes registrados. ➜ Nivel: [LOW] */
  VIEW_VISITORS              = 'VIEW_VISITORS',

  /** Ver historial de visitas del complejo. ➜ Nivel: [LOW] */
  VIEW_VISITS                = 'VIEW_VISITS',

  /** Registrar llegada de visitante (walk-in / delivery). ➜ Nivel: [MEDIUM] */
  REGISTER_VISITOR_ENTRY     = 'REGISTER_VISITOR_ENTRY',

  /** Registrar salida de visitante. ➜ Nivel: [MEDIUM] */
  REGISTER_VISITOR_EXIT      = 'REGISTER_VISITOR_EXIT',

  /** Agendar visita y generar QR (por residentes). ➜ Nivel: [LOW] */
  SCHEDULE_VISIT             = 'SCHEDULE_VISIT',

  /** Aprobar o denegar una visita walk-in (por residentes). ➜ Nivel: [LOW] */
  APPROVE_VISIT              = 'APPROVE_VISIT',

  /** Bloquear o desbloquear un visitante. ➜ Nivel: [HIGH] */
  BLACKLIST_VISITOR          = 'BLACKLIST_VISITOR',

  // ═══════════════════════════════════════════════════════
  // VEHÍCULOS
  // ═══════════════════════════════════════════════════════

  /** Ver vehículos registrados en el complejo. ➜ Nivel: [LOW] */
  VIEW_VEHICLES              = 'VIEW_VEHICLES',

  /** Registrar un vehículo nuevo. ➜ Nivel: [MEDIUM] */
  REGISTER_VEHICLE           = 'REGISTER_VEHICLE',

  /** Editar datos de un vehículo. ➜ Nivel: [MEDIUM] */
  EDIT_VEHICLE               = 'EDIT_VEHICLE',

  /** Aprobar, rechazar o suspender vehículos. ➜ Nivel: [HIGH] */
  APPROVE_VEHICLE            = 'APPROVE_VEHICLE',

  /** Retirar definitivamente un vehículo del complejo. ➜ Nivel: [HIGH] */
  REMOVE_VEHICLE             = 'REMOVE_VEHICLE',

  /** Consultar placa en portería. ➜ Nivel: [LOW] */
  CHECK_PLATE                = 'CHECK_PLATE',

  // ═══════════════════════════════════════════════════════
  // FINANZAS
  // ═══════════════════════════════════════════════════════

  /** Ver configuraciones de cuotas del complejo. ➜ Nivel: [LOW] */
  VIEW_FEE_CONFIGS           = 'VIEW_FEE_CONFIGS',

  /** Crear/editar/desactivar configuraciones de cuotas. ➜ Nivel: [HIGH] */
  MANAGE_FEE_CONFIGS         = 'MANAGE_FEE_CONFIGS',

  /** Ver cargos (cuotas generadas) de unidades. ➜ Nivel: [LOW] */
  VIEW_CHARGES               = 'VIEW_CHARGES',

  /** Generar cargos para un período de facturación. ➜ Nivel: [HIGH] */
  GENERATE_CHARGES           = 'GENERATE_CHARGES',

  /** Exonerar / cancelar un cargo. ➜ Nivel: [HIGH] */
  WAIVE_CHARGE               = 'WAIVE_CHARGE',

  /** Ver pagos registrados. ➜ Nivel: [LOW] */
  VIEW_PAYMENTS              = 'VIEW_PAYMENTS',

  /** Registrar un pago de un residente. ➜ Nivel: [MEDIUM] */
  REGISTER_PAYMENT           = 'REGISTER_PAYMENT',

  /** Revertir / anular un pago registrado. ➜ Nivel: [HIGH] */
  REVERSE_PAYMENT            = 'REVERSE_PAYMENT',

  /** Ver balance y estado de cuenta de unidades. ➜ Nivel: [LOW] */
  VIEW_ACCOUNT_BALANCE       = 'VIEW_ACCOUNT_BALANCE',

  /** Ver reportes financieros del complejo. ➜ Nivel: [MEDIUM] */
  VIEW_FINANCIAL_REPORTS     = 'VIEW_FINANCIAL_REPORTS',

  /** PERMISO MAESTRO. ➜ Nivel: [CRITICAL] | Requiere: [TODOS] */
  SUPERADMIN                = 'SUPERADMIN',
}
