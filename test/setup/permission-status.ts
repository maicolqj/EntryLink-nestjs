// Solo pruebas: el estado de los permisos se declara verificado (todos
// activos) sin levantar PermissionStatusService. En producción el estado lo
// mantiene el servicio y, sin verificar, se niega todo. Las pruebas del
// propio estado lo reinician con resetInactivePermissions().
import { trustPermissionStatusForTests } from '../../src/modules/shared/permission-status/permission-status.registry';

trustPermissionStatusForTests();
