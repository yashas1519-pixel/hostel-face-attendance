import {
  Controller, Get, Post, Patch, Body, Param, Query,
  Req, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { LeaveService } from './leave.service.js';
import { ApplyLeaveDto, ReviewLeaveDto } from './leave.dto.js';
import { Auth } from '../auth/roles.guard.js';
import type { JwtPayload } from '../auth/jwt.strategy.js';

@Controller()
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  // ── Student routes ─────────────────────────────────────────────────────

  @Post('leave/request')
  @Auth()
  apply(@Req() req: { user: JwtPayload }, @Body() dto: ApplyLeaveDto) {
    return this.leave.apply(req.user.sub, dto);
  }

  @Get('leave/my-requests')
  @Auth()
  myRequests(
    @Req() req: { user: JwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.leave.myRequests(req.user.sub, page, Math.min(limit, 100));
  }

  @Patch('leave/:id/early-return')
  @Auth()
  earlyReturn(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.leave.markEarlyReturn(req.user.sub, id);
  }

  // ── Admin routes ───────────────────────────────────────────────────────

  @Get('admin/leave')
  @Auth('admin')
  adminList(
    @Query('hostelId') hostelId?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    return this.leave.adminList(hostelId, status, page, Math.min(limit, 100));
  }

  @Post('admin/leave/:id/approve')
  @Auth('admin')
  approve(@Param('id') id: string, @Body() dto: ReviewLeaveDto) {
    return this.leave.review(id, 'approve', dto);
  }

  @Post('admin/leave/:id/reject')
  @Auth('admin')
  reject(@Param('id') id: string, @Body() dto: ReviewLeaveDto) {
    return this.leave.review(id, 'reject', dto);
  }
}
