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
import { AttendanceService } from './attendance.service.js';
import { MarkAttendanceDto } from './attendance.dto.js';

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('attendance/mark')
  @Auth('student')
  mark(@Body() dto: MarkAttendanceDto, @Req() req: { user: JwtPayload }) {
    return this.attendance.markAttendance(req.user.sub, dto);
  }

  @Get('attendance/history')
  @Auth('student')
  history(
    @Req() req: { user: JwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.attendance.getHistory(req.user.sub, page, Math.min(limit, 100));
  }

  // hostelId now optional query param — frontend calls /admin/attendance?hostelId=...
  @Get('admin/attendance')
  @Auth('admin')
  adminView(
    @Query('hostelId') hostelId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.attendance.getAdminView(
      hostelId,
      status,
      dateFrom,
      dateTo,
      page,
      Math.min(limit, 100),
    );
  }
}
