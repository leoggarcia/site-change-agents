import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BoardModule } from './board/board.module.js';
import { dataSourceOptions } from './database/data-source.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { SitesModule } from './sites/sites.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { TracesModule } from './traces/traces.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...dataSourceOptions(), migrationsRun: true }),
    }),
    UsersModule,
    SitesModule,
    TicketsModule,
    MetricsModule,
    BoardModule,
    TracesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
