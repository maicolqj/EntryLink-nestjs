import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';

@Injectable()
export class PermissionDependencyService {
  // Logger para registrar eventos y errores del servicio
  private readonly logger = new Logger(PermissionDependencyService.name);

  constructor(
    // Inyección del repositorio de Permission para operaciones de BD
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) { }

  /**
   * MÉTODO 1: validateCircularDependency
   * Propósito: Valida que no se creen dependencias circulares entre permisos
   * Ejemplo: Si A depende de B, B no puede depender de A (directa o indirectamente)
   */
  async validateCircularDependency(
    permissionId: string,     // ID del permiso que se está creando/modificando
    dependencyIds: string[],  // Array de IDs de permisos de los que depende
  ): Promise<boolean> {

    // Itera sobre cada dependencia propuesta para validarla individualmente
    for (const dependencyId of dependencyIds) {

      // Llama al método privado que hace la validación recursiva
      if (await this.hasCircularDependency(permissionId, dependencyId)) {

        // Si encuentra dependencia circular, lanza excepción con mensaje descriptivo
        throw new BadRequestException(
          `Dependencia circular detectada entre el permiso ${permissionId} y ${dependencyId}`,
        );
      }
    }

    // Registra en log que la validación fue exitosa
    this.logger.debug(`Validación de dependencias circulares exitosa para ${permissionId}`);

    // Retorna true si no hay dependencias circulares
    return true;
  }

  /**
   * MÉTODO 2: hasCircularDependency (PRIVADO)
   * Propósito: Método recursivo que busca dependencias circulares en profundidad
   * Algoritmo: DFS (Depth-First Search) para detectar ciclos en el grafo de dependencias
   */
  private async hasCircularDependency(
    permissionId: string,           // Permiso origen (el que estamos validando)
    dependencyId: string,           // Permiso actual en la búsqueda
    visited: Set<string> = new Set(), // Conjunto de nodos visitados para evitar loops infinitos
  ): Promise<boolean> {

    // CASO BASE 1: Si el permiso depende de sí mismo, hay dependencia circular
    if (permissionId === dependencyId) {
      return true;
    }

    // CASO BASE 2: Si ya visitamos este nodo, no hay ciclo en esta rama
    if (visited.has(dependencyId)) {
      return false;
    }

    // Marca el nodo actual como visitado
    visited.add(dependencyId);

    // Busca el permiso de dependencia en BD con sus relaciones
    const dependency = await this.permissionRepository.findOne({
      where: { id: dependencyId },
      relations: ['dependsOn'],  // Carga las dependencias de este permiso
    });

    // Si no existe el permiso o no tiene dependencias, no hay ciclo
    if (!dependency || !dependency.dependsOn) {
      return false;
    }

    // RECURSIÓN: Verifica cada dependencia de la dependencia actual
    for (const subDependency of dependency.dependsOn) {
      // Llamada recursiva para buscar ciclos en dependencias más profundas
      if (await this.hasCircularDependency(permissionId, subDependency.id, visited)) {
        return true; // Se encontró un ciclo
      }
    }

    // No se encontró ciclo en esta rama
    return false;
  }

  /**
   * MÉTODO 3: getAllDependencies
   * Propósito: Obtiene todas las dependencias de un permiso (directas e indirectas)
   * Ejemplo: Si A depende de B, y B depende de C, retorna [B, C]
   */
  async getAllDependencies(permissionId: string): Promise<Permission[]> {

    // Set para evitar dependencias duplicadas y loops infinitos
    const visited = new Set<string>();

    // Array que almacenará todas las dependencias encontradas
    const dependencies: Permission[] = [];

    // Llama al método recursivo que recolecta las dependencias
    await this.collectDependencies(permissionId, visited, dependencies);

    // Log del resultado para debugging
    this.logger.debug(`Dependencias encontradas para ${permissionId}: ${dependencies.length}`);

    return dependencies;
  }

  /**
   * MÉTODO 4: collectDependencies (PRIVADO)
   * Propósito: Método recursivo que recolecta dependencias en profundidad
   * Usa DFS para recorrer todo el árbol de dependencias
   */
  private async collectDependencies(
    permissionId: string,         // ID del permiso actual
    visited: Set<string>,         // Nodos ya visitados
    dependencies: Permission[],   // Array donde se acumulan las dependencias
  ): Promise<void> {

    // Si ya procesamos este permiso, salir para evitar loop infinito
    if (visited.has(permissionId)) {
      return;
    }

    // Marcar como visitado
    visited.add(permissionId);

    // Buscar el permiso en BD con sus dependencias directas
    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId },
      relations: ['dependsOn'],
    });

    // Si no existe o no tiene dependencias, terminar
    if (!permission || !permission.dependsOn) {
      return;
    }

    // Procesar cada dependencia directa
    for (const dependency of permission.dependsOn) {

      // Verificar si ya está en el array de dependencias (evitar duplicados)
      if (!dependencies.find(d => d.id === dependency.id)) {
        dependencies.push(dependency); // Agregar al resultado
      }

      // RECURSIÓN: Buscar dependencias de esta dependencia
      await this.collectDependencies(dependency.id, visited, dependencies);
    }
  }

  /**
   * MÉTODO 5: validateUserPermissions
   * Propósito: Verifica si un usuario tiene todos los permisos necesarios
   * Incluye validación de dependencias transitivas
   */
  async validateUserPermissions(
    userPermissions: string[],    // Array de IDs de permisos que tiene el usuario
    requiredPermission: string,   // ID del permiso que se quiere validar
  ): Promise<boolean> {

    // Obtener todas las dependencias del permiso requerido (incluyendo transitivas)
    const allDependencies = await this.getAllDependencies(requiredPermission);

    // Crear array con el permiso requerido y todas sus dependencias
    const requiredPermissionIds = [
      requiredPermission,                    // El permiso principal
      ...allDependencies.map(dep => dep.id), // Todas las dependencias
    ];

    // Verificar que el usuario tenga TODOS los permisos necesarios
    const hasAllPermissions = requiredPermissionIds.every(permId =>
      userPermissions.includes(permId)
    );

    // Log del resultado para auditoría
    this.logger.debug(
      `Validación de permisos para usuario. Requeridos: ${requiredPermissionIds.length}, Usuario tiene todos: ${hasAllPermissions}`
    );

    return hasAllPermissions;
  }

  /**
   * MÉTODO 6: updatePermissionDependencies
   * Propósito: Actualiza las dependencias de un permiso existente
   * Incluye validaciones de seguridad antes de la actualización
   */
  async updatePermissionDependencies(
    permissionId: string,    // ID del permiso a actualizar
    dependencyIds: string[], // Nuevos IDs de dependencias
  ): Promise<Permission> {

    // VALIDACIÓN 1: Verificar dependencias circulares antes de actualizar
    await this.validateCircularDependency(permissionId, dependencyIds);

    // VALIDACIÓN 2: Verificar que el permiso a actualizar existe
    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId },
      relations: ['dependsOn'], // Cargar dependencias actuales
    });

    if (!permission) {
      throw new BadRequestException('Permiso no encontrado');
    }

    // VALIDACIÓN 3: Verificar que todas las nuevas dependencias existen
    const dependencies = await this.permissionRepository.findByIds(dependencyIds);

    if (dependencies.length !== dependencyIds.length) {
      // Identificar cuáles dependencias no existen
      const foundIds = dependencies.map(d => d.id);
      const missingIds = dependencyIds.filter(id => !foundIds.includes(id));

      throw new BadRequestException(
        `Algunas dependencias no fueron encontradas: ${missingIds.join(', ')}`
      );
    }

    // Log de la operación
    this.logger.log(`Actualizando dependencias para permiso ${permissionId}`);

    // ACTUALIZACIÓN: Asignar las nuevas dependencias
    permission.dependsOn = dependencies;

    // Guardar cambios en BD y retornar el permiso actualizado
    return await this.permissionRepository.save(permission);
  }

  /**
   * MÉTODO 7: getDependencyTree
   * Propósito: Construye un árbol jerárquico de dependencias para visualización
   * Útil para interfaces gráficas que muestran dependencias como árbol
   */
  async getDependencyTree(permissionId: string): Promise<any> {

    // Buscar el permiso raíz con sus dependencias directas
    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId },
      relations: ['dependsOn'],
    });

    // Si no existe el permiso, retornar null
    if (!permission) {
      this.logger.warn(`Permiso no encontrado para árbol de dependencias: ${permissionId}`);
      return null;
    }

    /**
     * FUNCIÓN RECURSIVA INTERNA: buildTree
     * Construye recursivamente el árbol de dependencias
     */
    const buildTree = async (perm: Permission): Promise<any> => {

      // Crear nodo del árbol con información básica del permiso
      const node = {
        id: perm.id,
        name: perm.name,
        description: perm.description,
        level: perm.level,
        children: [], // Array que contendrá los nodos hijos (dependencias)
      };

      // Si el permiso tiene dependencias, procesarlas recursivamente
      if (perm.dependsOn && perm.dependsOn.length > 0) {

        // Procesar cada dependencia
        for (const dependency of perm.dependsOn) {

          // Obtener información completa de la dependencia (con sus propias dependencias)
          const fullDependency = await this.permissionRepository.findOne({
            where: { id: dependency.id },
            relations: ['dependsOn'],
          });

          // Si existe, construir recursivamente su subárbol
          if (fullDependency) {
            node.children.push(await buildTree(fullDependency));
          }
        }
      }

      return node;
    };

    // Log y retorno del árbol completo
    this.logger.debug(`Construyendo árbol de dependencias para ${permissionId}`);
    return await buildTree(permission);
  }

  /**
   * MÉTODO 8: validateDependencyRemoval
   * Propósito: Valida si se pueden eliminar dependencias sin romper otros permisos
   * Evita eliminar dependencias que son requeridas por otros permisos
   */
  async validateDependencyRemoval(
    permissionId: string,     // ID del permiso del cual se quieren remover dependencias
    dependencyIds: string[],  // IDs de las dependencias que se quieren remover
  ): Promise<{ canRemove: boolean; conflicts: string[] }> {

    // Array para almacenar conflictos encontrados
    const conflicts: string[] = [];

    // Validar cada dependencia que se quiere remover
    for (const dependencyId of dependencyIds) {

      // Buscar otros permisos que dependan de esta dependencia
      const dependentPermissions = await this.permissionRepository
        .createQueryBuilder('permission')                    // Crear query builder
        .innerJoin('permission.dependsOn', 'dependency')     // Join con dependencias
        .where('dependency.id = :dependencyId', { dependencyId })  // Filtrar por dependencia específica
        .andWhere('permission.id != :permissionId', { permissionId }) // Excluir el permiso actual
        .getMany(); // Ejecutar query

      // Si hay otros permisos que dependen de esta dependencia, hay conflicto
      if (dependentPermissions.length > 0) {
        conflicts.push(
          `La dependencia ${dependencyId} es requerida por: ${dependentPermissions
            .map(p => p.name)  // Mapear a nombres legibles
            .join(', ')}`      // Unir con comas
        );
      }
    }

    // Log del resultado
    this.logger.debug(
      `Validación de remoción de dependencias. Conflictos encontrados: ${conflicts.length}`
    );

    // Retornar resultado de la validación
    return {
      canRemove: conflicts.length === 0,  // Se puede remover si no hay conflictos
      conflicts,                          // Lista de conflictos encontrados
    };
  }
}