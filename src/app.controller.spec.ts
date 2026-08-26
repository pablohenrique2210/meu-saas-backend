import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should report that the API is available', () => {
      expect(appController.getHealth()).toEqual(
        expect.objectContaining({ status: 'ok', service: 'meu-saas-backend' }),
      );
    });
  });
});
