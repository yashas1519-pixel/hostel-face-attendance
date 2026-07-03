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
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { eq, sql, and } from 'drizzle-orm';
import { Auth } from '../auth/roles.guard.js';
import type { JwtPayload } from '../auth/jwt.strategy.js';
import { HostelService } from './hostel.service.js';
import { CreateHostelDto, UpdateHostelDto, AssignStudentsDto } from './hostel.dto.js';
import { DB_TOKEN, type Database } from '../db/index.js';
import {
  users,
  hostels,
  studentHostelAssignments,
  attendanceRecords,
} from '../db/schema.js';

@Controller()
export class HostelController {
  constructor(
    private readonly hostels: HostelService,
    @Inject(DB_TOKEN) private readonly db: Database,
  ) {}

  // ── Student-facing hostel routes ────────────────────────────
  @Post('hostel')
  @Auth('admin')
  create(@Body() dto: CreateHostelDto, @Req() req: { user: JwtPayload }) {
    return this.hostels.create(dto, req.user.sub);
  }

  @Get('hostel')
  @Auth()
  list(
    @Query('collegeName') collegeName: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.hostels.list(collegeName, page, Math.min(limit, 100));
  }

  @Patch('hostel/:id')
  @Auth('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHostelDto) {
    return this.hostels.update(id, dto);
  }

  @Post('hostel/:id/assign')
  @Auth('admin')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignStudentsDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.hostels.assignStudents(id, dto, req.user.sub);
  }

  // ── Admin panel routes ──────────────────────────────────────

  @Get('admin/dashboard/stats')
  @Auth('admin')
  async dashboardStats() {
    const [[studentsRow], [boysRow], [girlsRow], [pendingRow], [todayRow], [totalRow]] =
      await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(eq(users.role, 'student')),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(hostels)
          .where(eq(hostels.type, 'boys')),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(hostels)
          .where(eq(hostels.type, 'girls')),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(eq(users.role, 'student'), eq(users.enrollmentStatus, 'pending')),
          ),
        this.db
          .select({ count: sql<number>`count(distinct student_id)::int` })
          .from(attendanceRecords)
          .where(
            sql`DATE(marked_at) = CURRENT_DATE AND status = 'present'`,
          ),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(eq(users.role, 'student')),
      ]);

    const total = totalRow?.count ?? 0;
    const todayCount = todayRow?.count ?? 0;

    return {
      totalStudents: studentsRow?.count ?? 0,
      boysHostelCount: boysRow?.count ?? 0,
      girlsHostelCount: girlsRow?.count ?? 0,
      pendingEnrollments: pendingRow?.count ?? 0,
      todayAttendancePercent:
        total > 0 ? Math.round((todayCount / total) * 100) : 0,
    };
  }

  @Get('admin/hostels')
  @Auth('admin')
  async adminHostels(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    const offset = (page - 1) * limit;
    const rows = await this.db
      .select()
      .from(hostels)
      .limit(Math.min(limit, 100))
      .offset(offset);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(hostels);

    return { data: rows, total: countRow?.count ?? 0, page, limit };
  }

  @Get('admin/students')
  @Auth('admin')
  async adminStudents(
    @Query('hostelId') hostelId: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const offset = (page - 1) * Math.min(limit, 100);

    // Join with hostel assignment to get hostel name
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        rollNumber: users.rollNumber,
        enrollmentStatus: users.enrollmentStatus,
        collegeName: users.collegeName,
        createdAt: users.createdAt,
        hostelId: studentHostelAssignments.hostelId,
        hostelName: hostels.name,
      })
      .from(users)
      .leftJoin(
        studentHostelAssignments,
        eq(users.id, studentHostelAssignments.studentId),
      )
      .leftJoin(hostels, eq(studentHostelAssignments.hostelId, hostels.id))
      .where(
        hostelId
          ? and(eq(users.role, 'student'), eq(studentHostelAssignments.hostelId, hostelId))
          : eq(users.role, 'student'),
      )
      .limit(Math.min(limit, 100))
      .offset(offset);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, 'student'));

    return { data: rows, total: countRow?.count ?? 0, page, limit };
  }

  @Post('admin/students/:id/assign')
  @Auth('admin')
  async assignStudentToHostel(
    @Param('id', ParseUUIDPipe) studentId: string,
    @Body('hostelId') hostelId: string | null,
    @Req() req: { user: JwtPayload },
  ) {
    // Remove any existing assignment first
    await this.db
      .delete(studentHostelAssignments)
      .where(eq(studentHostelAssignments.studentId, studentId));

    if (hostelId) {
      // Verify hostel exists
      const [hostel] = await this.db
        .select({ id: hostels.id })
        .from(hostels)
        .where(eq(hostels.id, hostelId))
        .limit(1);
      if (!hostel) throw new NotFoundException('Hostel not found');

      await this.db.insert(studentHostelAssignments).values({
        studentId,
        hostelId,
        assignedBy: req.user.sub,
      });
    }

    return { assigned: !!hostelId };
  }
}
