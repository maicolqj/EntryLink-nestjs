import { PermissionsService } from './permissions.service';

describe('PermissionsService.findAll', () => {
  const build = () => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repo = {
      createQueryBuilder: jest.fn(() => qb),
      metadata: {
        findColumnWithPropertyName: (name: string) =>
          ['createdAt', 'name', 'group'].includes(name) ? {} : undefined,
      },
    };
    const service = new PermissionsService(
      repo as never,
      {} as never,
      {} as never,
    );
    return { service, qb };
  };

  it('responde con solo la página: sin sort ni filters no revienta', async () => {
    const { service, qb } = build();

    const result = await service.findAll({
      pagination: { page: 2, limit: 12 },
    } as never);

    expect(qb.orderBy).toHaveBeenCalledWith('permission.createdAt', 'DESC');
    expect(qb.skip).toHaveBeenCalledWith(12);
    expect(qb.take).toHaveBeenCalledWith(12);
    expect(result.meta.currentPage).toBe(2);
  });

  it('ignora un campo de orden que no es una columna', async () => {
    const { service, qb } = build();

    await service.findAll({
      sort: { field: 'id; DROP TABLE roles', direction: 'ASC' },
    } as never);

    expect(qb.orderBy).toHaveBeenCalledWith('permission.createdAt', 'ASC');
  });

  it('el filtro category busca por el grupo del permiso', async () => {
    const { service, qb } = build();

    await service.findAll({ filters: { category: 'USERS' } } as never);

    expect(qb.andWhere).toHaveBeenCalledWith('permission.group = :category', {
      category: 'USERS',
    });
  });
});
