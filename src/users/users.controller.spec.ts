import { UsersController } from './users.controller';
import type { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(() => {
    controller = new UsersController({} as UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
