import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { Auth } from '../auth/roles.guard.js';
import type { JwtPayload } from '../auth/jwt.strategy.js';
import { HostelService } from './hostel.service.js';
import { CreateHostelDto, UpdateHostelDto, AssignStudentsDto } from './hostel.dto.js';

@Controller('hostel')
export class HostelController {
  constructor(private readonly hostels: HostelService) {}

  @Post()
  @Auth('admin')
  create(@Body() dto: CreateHostelDto, @Req() req: { user: JwtPayload }) {
    return this.hostels.create(dto, req.user.sub);
  }

  @Get()
  @Auth()
  list(
    @Query('collegeName') collegeName: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.hostels.list(collegeName, page, Math.min(limit, 100));
  }

  @Patch(':id')
  @Auth('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHostelDto) {
    return this.hostels.update(id, dto);
  }

  @Post(':id/assign')
  @Auth('admin')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignStudentsDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.hostels.assignStudents(id, dto, req.user.sub);
  }
}
