import {
  Controller, Get, Post, Delete, Param, Body, Req, ParseUUIDPipe,
} from '@nestjs/common';
import { Auth } from '../auth/roles.guard.js';
import type { JwtPayload } from '../auth/jwt.strategy.js';
import { WardenService } from './warden.service.js';
import { AssignWardenDto, ManualAttendanceDto } from './warden.dto.js';

@Controller()
export class WardenController {
  constructor(private readonly warden: WardenService) {}

  // ── Warden routes ───────────────────────────────────────────────────
  @Get('warden/my-hostel')
  @Auth('warden')
  myHostel(@Req() req: { user: JwtPayload }) {
    return this.warden.getMyHostel(req.user.sub);
  }

  @Get('warden/failures')
  @Auth('warden')
  failures(@Req() req: { user: JwtPayload }) {
    return this.warden.getFailures(req.user.sub);
  }

  @Post('warden/attendance/manual')
  @Auth('warden')
  manualMark(@Body() dto: ManualAttendanceDto, @Req() req: { user: JwtPayload }) {
    return this.warden.manualMark(req.user.sub, dto);
  }

  // ── Admin routes ────────────────────────────────────────────────────
  @Get('admin/wardens')
  @Auth('admin')
  listAll() {
    return this.warden.listAllWardens();
  }

  @Get('admin/hostel/:id/wardens')
  @Auth('admin')
  listWardens(@Param('id', ParseUUIDPipe) id: string) {
    return this.warden.listWardens(id);
  }

  @Post('admin/hostel/:id/wardens')
  @Auth('admin')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWardenDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.warden.assignWarden(req.user.sub, id, dto);
  }

  @Delete('admin/hostel/:id/wardens/:wardenId')
  @Auth('admin')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('wardenId', ParseUUIDPipe) wardenId: string,
  ) {
    return this.warden.removeWarden(id, wardenId);
  }
}
