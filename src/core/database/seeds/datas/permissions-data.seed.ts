import { ValidPermissions } from "../../../../modules/permissions/enums/valid-permissions";

export const PERMISSIONS_TO_SEED = [
  // STAFF
  { id: '468a3564-966a-466d-8e42-9905206f0b83', name: ValidPermissions.VIEW_USERS, label: 'Ver Usuarios', group: 'STAFF', isSystem: true, status: true, description: 'Acceso de lectura a lista de personal', level: 'LOW', dependsOn: [] },
  { id: '7c86a29e-224a-472e-8930-9b43c6837943', name: ValidPermissions.VIEW_SENSITIVE_USER_DATA, label: 'Ver Datos Sensibles', group: 'STAFF', isSystem: true, status: true, description: 'Acceso a email, teléfono y dirección', level: 'CRITICAL', dependsOn: [ValidPermissions.VIEW_USERS] },
  { id: '5561571d-5564-4e4f-b188-724f54799071', name: ValidPermissions.CREATE_USER, label: 'Crear Usuario', group: 'STAFF', isSystem: true, status: true, description: 'Registro de nuevo personal', level: 'MEDIUM', dependsOn: [ValidPermissions.VIEW_USERS] },
  { id: 'b0a34079-6616-4a34-9721-6e3e4a9c8b7f', name: ValidPermissions.EDIT_USER, label: 'Editar Usuario', group: 'STAFF', isSystem: true, status: true, description: 'Modificación de perfiles de personal', level: 'MEDIUM', dependsOn: [ValidPermissions.VIEW_USERS] },
  { id: '2f8a4583-1b91-4927-9653-39d67b2d5f30', name: ValidPermissions.BLOCK_USER, label: 'Bloquear Usuario', group: 'STAFF', isSystem: true, status: true, description: 'Bloqueo temporal de cuenta', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_USERS] },
  { id: '965306d8-941c-4389-9d5a-59b369992f45', name: ValidPermissions.DELETE_USER, label: 'Eliminar Usuario', group: 'STAFF', isSystem: true, status: true, description: 'Eliminación permanente', level: 'CRITICAL', dependsOn: [ValidPermissions.VIEW_USERS] },
  { id: 'e366887f-9467-4662-9721-953e97034f5d', name: ValidPermissions.MANAGE_USERS, label: 'Gestionar Usuarios', group: 'STAFF', isSystem: true, status: true, description: 'Control total de personal', level: 'CRITICAL', dependsOn: [ValidPermissions.VIEW_USERS, ValidPermissions.DELETE_USER, ValidPermissions.BLOCK_USER] },

  // ROLES
  { id: '85662a5b-6f68-45e0-8239-668b57743d1a', name: ValidPermissions.VIEW_ROLES, label: 'Ver Roles', group: 'ROLES', isSystem: true, status: true, description: 'Listado de roles del sistema', level: 'LOW', dependsOn: [] },
  { id: '0a631627-99f6-4994-8789-983694037f4a', name: ValidPermissions.CREATE_ROLE, label: 'Crear Rol', group: 'ROLES', isSystem: true, status: true, description: 'Creación de nuevas definiciones de rol', level: 'MEDIUM', dependsOn: [ValidPermissions.VIEW_ROLES] },
  { id: '792f9746-8152-4418-8686-36365377f0d0', name: ValidPermissions.EDIT_ROLE, label: 'Editar Rol', group: 'ROLES', isSystem: true, status: true, description: 'Modificar definiciones de rol', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_ROLES] },
  { id: 'd7486f0c-7880-482d-829d-4876644f6f43', name: ValidPermissions.ASSIGN_PERMISSIONS, label: 'Asignar Permisos', group: 'ROLES', isSystem: true, status: true, description: 'Vincular permisos a un rol', level: 'CRITICAL', dependsOn: [ValidPermissions.EDIT_ROLE] },
  { id: 'f87a8b4a-1a22-4a33-8c76-5a4e3b2c1d0f', name: ValidPermissions.DELETE_ROLE, label: 'Eliminar Rol', group: 'ROLES', isSystem: true, status: true, description: 'Eliminar un rol del sistema', level: 'CRITICAL', dependsOn: [ValidPermissions.VIEW_ROLES] },
  { id: 'c9d8e7f6-a5b4-4321-8901-23456789abcd', name: ValidPermissions.MANAGE_ROLES, label: 'Gestionar Roles', group: 'ROLES', isSystem: true, status: true, description: 'Control total de roles', level: 'CRITICAL', dependsOn: [ValidPermissions.VIEW_ROLES, ValidPermissions.ASSIGN_PERMISSIONS] },

  // RESIDENTS
  { id: '3b9d0a32-8e1c-4b5c-9d6a-4f5e7d8c9a0b', name: ValidPermissions.VIEW_RESIDENTS, label: 'Ver Residentes', group: 'RESIDENTS', isSystem: false, status: true, description: 'Consulta de censo de residentes', level: 'LOW', dependsOn: [] },
  { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: ValidPermissions.CREATE_RESIDENTS, label: 'Crear Residente', group: 'RESIDENTS', isSystem: false, status: true, description: 'Registro de nuevo residente', level: 'MEDIUM', dependsOn: [ValidPermissions.VIEW_RESIDENTS] },
  { id: 'f9e8d7c6-b5a4-4321-8901-234567890abc', name: ValidPermissions.EDIT_RESIDENTS, label: 'Editar Residente', group: 'RESIDENTS', isSystem: false, status: true, description: 'Actualizar datos de residente', level: 'MEDIUM', dependsOn: [ValidPermissions.VIEW_RESIDENTS] },
  { id: '5d4c3b2a-1f0e-49d8-bc7a-6b5a4d3c2b1a', name: ValidPermissions.VIEW_RECIDENTS_LOCATION, label: 'Ver Ubicación', group: 'RESIDENTS', isSystem: false, status: true, description: 'Ubicación en el complejo', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_RESIDENTS] },
  { id: '7a8b9c0d-1e2f-4a3b-8c9d-0e1f2a3b4c5d', name: ValidPermissions.BLOCK_RESIDENTS, label: 'Bloquear Residente', group: 'RESIDENTS', isSystem: false, status: true, description: 'Restringir acceso', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_RESIDENTS] },
  { id: '2d3e4f5a-6b7c-48d9-ae0f-1a2b3c4d5e6f', name: ValidPermissions.DELETE_RESIDENTS, label: 'Eliminar Residente', group: 'RESIDENTS', isSystem: false, status: true, description: 'Eliminar ficha de residente', level: 'CRITICAL', dependsOn: [ValidPermissions.VIEW_RESIDENTS] },
  { id: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e', name: ValidPermissions.MANAGE_RESIDENTS, label: 'Gestionar Residentes', group: 'RESIDENTS', isSystem: false, status: true, description: 'Administración de residentes', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_RESIDENTS, ValidPermissions.BLOCK_RESIDENTS] },

  // PACKAGES
  { id: '9a8b7c6d-5e4f-4321-8d9e-0f1a2b3c4d5e', name: ValidPermissions.VIEW_PACKAGES, label: 'Ver Paquetes', group: 'PACKAGES', isSystem: false, status: true, description: 'Listado de correspondencia', level: 'LOW', dependsOn: [] },
  { id: 'e1d2c3b4-a5f6-47e8-9d0c-1b2a3d4f5e6a', name: ValidPermissions.CREATE_PACKAGE, label: 'Registrar Paquete', group: 'PACKAGES', isSystem: false, status: true, description: 'Ingreso de paquete', level: 'LOW', dependsOn: [] },
  { id: '6f7a8b9c-0d1e-4f2a-3b4c-5d6e7f8a9b0c', name: ValidPermissions.EDIT_PACKAGE, label: 'Editar Paquete', group: 'PACKAGES', isSystem: false, status: true, description: 'Modificar datos de paquete', level: 'MEDIUM', dependsOn: [ValidPermissions.VIEW_PACKAGES] },
  { id: 'c1b2a3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: ValidPermissions.EXPORT_PACKAGES, label: 'Exportar Paquetes', group: 'PACKAGES', isSystem: false, status: true, description: 'Reporte de correspondencia', level: 'MEDIUM', dependsOn: [ValidPermissions.VIEW_PACKAGES] },
  { id: 'd8e9f0a1-b2c3-4d4e-af6a-7b8c9d0e1f2a', name: ValidPermissions.MANAGE_PACKAGES, label: 'Gestionar Paquetes', group: 'PACKAGES', isSystem: false, status: true, description: 'Administración total de envíos', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_PACKAGES] },

  // RESIDENCES
  { id: '4e5f6a7b-8c9d-0e1f-2a3b-4c5d6e7f8a9b', name: ValidPermissions.VIEW_RESIDENCES, label: 'Ver Residencias', group: 'RESIDENCES', isSystem: true, status: true, description: 'Consulta de inmuebles', level: 'LOW', dependsOn: [] },
  { id: 'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c', name: ValidPermissions.CREATE_RESIDENCE, label: 'Crear Residencia', group: 'RESIDENCES', isSystem: true, status: true, description: 'Alta de propiedad', level: 'MEDIUM', dependsOn: [] },
  { id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', name: ValidPermissions.EDIT_RESIDENCE, label: 'Editar Residencia', group: 'RESIDENCES', isSystem: true, status: true, description: 'Editar propiedades', level: 'MEDIUM', dependsOn: [ValidPermissions.VIEW_RESIDENCES] },
  { id: '0d1e2f3a-4b5c-4d6e-7f8a-9b0c1d2e3f4a', name: ValidPermissions.TOGGLE_RESIDENCE_STATUS, label: 'Estado Residencia', group: 'RESIDENCES', isSystem: true, status: true, description: 'Activar/Desactivar', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_RESIDENCES] },
  { id: '8b9c0d1e-2f3a-4b4c-5d6e-7f8a9b0c1d2e', name: ValidPermissions.DELETE_RESIDENCE, label: 'Eliminar Residencia', group: 'RESIDENCES', isSystem: true, status: true, description: 'Eliminar inmueble', level: 'CRITICAL', dependsOn: [ValidPermissions.VIEW_RESIDENCES] },
  { id: 'a5b6c7d8-e9f0-4a1b-2c3d-4e5f6a7b8c9d', name: ValidPermissions.MANAGE_RESIDENCES, label: 'Gestionar Residencias', group: 'RESIDENCES', isSystem: true, status: true, description: 'Control total inmuebles', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_RESIDENCES] },
  { id: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f', name: ValidPermissions.VIEW_PRODUCTS, label: 'Ver Productos', group: 'PRODUCTS', isSystem: false, status: true, description: 'Catalogo', level: 'LOW', dependsOn: [] },
  { id: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b', name: ValidPermissions.MANAGE_PRODUCTS, label: 'Gestionar Productos', group: 'PRODUCTS', isSystem: false, status: true, description: 'Control de productos', level: 'MEDIUM', dependsOn: [ValidPermissions.VIEW_PRODUCTS] },

  // SYSTEM
  { id: '9d0e1f2a-3b4c-4d5e-6f7a-8b9c0d1e2f3a', name: ValidPermissions.VIEW_REPORTS, label: 'Ver Reportes', group: 'SYSTEM', isSystem: true, status: true, description: 'Analítica', level: 'MEDIUM', dependsOn: [] },
  { id: '7b8c9d0e-1f2a-4b3c-4d5e-6f7a8b9c0d1e', name: ValidPermissions.EXPORT_REPORTS, label: 'Exportar Reportes', group: 'SYSTEM', isSystem: true, status: true, description: 'Descargar datos', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_REPORTS] },
  { id: '5f6a7b8c-9d0e-4f1a-2b3c-4d5e6f7a8b9c', name: ValidPermissions.VIEW_SETTINGS, label: 'Ver Configuración', group: 'SYSTEM', isSystem: true, status: true, description: 'Ver ajustes', level: 'LOW', dependsOn: [] },
  { id: '3d4e5f6a-7b8c-4d9e-0f1a-2b3c4d5e6f7a', name: ValidPermissions.EDIT_SETTINGS, label: 'Editar Configuración', group: 'SYSTEM', isSystem: true, status: true, description: 'Modificar ajustes', level: 'CRITICAL', dependsOn: [ValidPermissions.VIEW_SETTINGS] },
  { id: '1b2a3d4f-5e6a-4b7c-8d9e-0f1a2b3c4d5e', name: ValidPermissions.VIEW_NOTIFICATIONS, label: 'Ver Notificaciones', group: 'SYSTEM', isSystem: true, status: true, description: 'Leer mensajes', level: 'LOW', dependsOn: [] },
  { id: 'd9c8b7a6-f5e4-4d3c-2b1a-0f9e8d7c6b5a', name: ValidPermissions.SEND_NOTIFICATIONS, label: 'Enviar Notificaciones', group: 'SYSTEM', isSystem: true, status: true, description: 'Alertas masivas', level: 'HIGH', dependsOn: [ValidPermissions.VIEW_NOTIFICATIONS] },
  { id: 'f0e1d2c3-b4a5-4e6f-7d8c-9b0a1a2b3c4d', name: ValidPermissions.SUPERADMIN, label: 'SuperAdmin', group: 'SYSTEM', isSystem: true, status: true, description: 'Control absoluto', level: 'CRITICAL', dependsOn: [] },
];