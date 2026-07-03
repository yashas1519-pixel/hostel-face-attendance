import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Auth } from '../auth/roles.guard.js';
import type { JwtPayload } from '../auth/jwt.strategy.js';
import { EnrollmentService } from './enrollment.service.js';
import { SubmitEnrollmentDto } from './enrollment.dto.js';

@Controller()
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}

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

  @Post('admin/enrollment/:id/approve')
  @Auth('admin')
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.enrollment.approve(id);
  }

  @Post('admin/enrollment/:id/reject')
  @Auth('admin')
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.enrollment.reject(id);
  }
}
