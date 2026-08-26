import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      service: 'meu-saas-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
