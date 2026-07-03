import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Req,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { Auth } from '../auth/roles.guard.js';
import type { JwtPayload } from '../auth/jwt.strategy.js';
import { EnrollmentService } from './enrollment.service.js';
import { SubmitEnrollmentDto } from './enrollment.dto.js';

@Controller()
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}

  // ── Student routes ──────────────────────────────────────────
  @Post('enrollment/submit')
  @Auth('student')
  submit(@Body() dto: SubmitEnrollmentDto, @Req() req: { user: JwtPayload }) {
    return this.enrollment.submit(req.user.sub, dto);
  }

  @Get('enrollment/status')
  @Auth('student')
  status(@Req() req: { user: JwtPayload }) {
    return this.enrollment.getStatus(req.user.sub);
  }

  // ── Admin routes ────────────────────────────────────────────
  @Get('admin/enrollments')
  @Auth('admin')
  list(
    @Query('status') status: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.enrollment.list(status, page, Math.min(limit, 100));
  }

  @Post('admin/enrollments/:id/approve')
  @Auth('admin')
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.enrollment.approve(id);
  }

  @Post('admin/enrollments/:id/reject')
  @Auth('admin')
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.enrollment.reject(id);
  }
}
