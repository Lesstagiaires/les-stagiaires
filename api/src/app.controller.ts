import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health() {
    const result = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
    return { status: 'ok', database: 'connected', serverTime: result[0].now };
  }
}
