import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  service: 'api';
}

@Injectable()
export class AppService {
  getHealth(): HealthStatus {
    return { status: 'ok', service: 'api' };
  }
}
