import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { DB_TOKEN, type Database } from '../db/index.js';
import { leaveRequests, studentHostelAssignments } from '../db/schema.js';
import type { ApplyLeaveDto, ReviewLeaveDto } from './leave.dto.js';

@Injectable()
export class LeaveService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  async apply(studentId: string, dto: ApplyLeaveDto) {
    if (dto.fromDate > dto.toDate) {
      throw new BadRequestException('fromDate must be before or equal to toDate');
    }

    // Get student's hostel
    const [assignment] = await this.db
      .select({ hostelId: studentHostelAssignments.hostelId })
      .from(studentHostelAssignments)
      .where(eq(studentHostelAssignments.studentId, studentId))
      .limit(1);
    if (!assignment) throw new BadRequestException('You are not assigned to a hostel');

    const [record] = await this.db
      .insert(leaveRequests)
      .values({
        studentId,
        hostelId: assignment.hostelId,
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        reason: dto.reason,
      })
      .returning();
    return record;
  }

  async myRequests(studentId: string, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const rows = await this.db
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.studentId, studentId))
      .orderBy(desc(leaveRequests.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(leaveRequests)
      .where(eq(leaveRequests.studentId, studentId));
    return { data: rows, total: count ?? 0, page, limit };
  }

  async markEarlyReturn(studentId: string, leaveId: string) {
    const [leave] = await this.db
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, leaveId), eq(leaveRequests.studentId, studentId)))
      .limit(1);
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.status !== 'approved') throw new BadRequestException('Only approved leaves can have early return');
    if (leave.returnedEarlyAt) throw new BadRequestException('Early return already marked');

    const [updated] = await this.db
      .update(leaveRequests)
      .set({ returnedEarlyAt: new Date() })
      .where(eq(leaveRequests.id, leaveId))
      .returning();
    return updated;
  }

  // ── Admin ──────────────────────────────────────────────────────────────
  async adminList(hostelId: string | undefined, status: string | undefined, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const conditions = [];
    if (hostelId) conditions.push(eq(leaveRequests.hostelId, hostelId));
    if (status) conditions.push(eq(leaveRequests.status, status as 'pending' | 'approved' | 'rejected'));

    const where = conditions.length
      ? conditions.length === 1 ? conditions[0]! : and(...conditions)
      : undefined;

    const query = this.db
      .select()
      .from(leaveRequests)
      .orderBy(desc(leaveRequests.createdAt))
      .limit(limit)
      .offset(offset);

    const rows = where ? await query.where(where) : await query;
    const countQ = this.db.select({ count: sql<number>`count(*)::int` }).from(leaveRequests);
    const [{ count }] = where ? await countQ.where(where) : await countQ;
    return { data: rows, total: count ?? 0, page, limit };
  }

  async review(leaveId: string, action: 'approve' | 'reject', dto: ReviewLeaveDto) {
    const [leave] = await this.db
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.id, leaveId))
      .limit(1);
    if (!leave) throw new NotFoundException('Leave request not found');

    const [updated] = await this.db
      .update(leaveRequests)
      .set({ status: action === 'approve' ? 'approved' : 'rejected', adminNote: dto.adminNote ?? null })
      .where(eq(leaveRequests.id, leaveId))
      .returning();
    return updated;
  }
}
