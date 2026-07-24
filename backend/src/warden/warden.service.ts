import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { DB_TOKEN, type Database } from '../db/index.js';
import {
  hostelWardens,
  livenessFailures,
  users,
  attendanceRecords,
  studentHostelAssignments,
  hostels,
  checkInWindows,
} from '../db/schema.js';
import type { AssignWardenDto, ManualAttendanceDto } from './warden.dto.js';

@Injectable()
export class WardenService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  /** Get the hostel this warden is assigned to */
  async getMyHostel(wardenId: string) {
    const [row] = await this.db
      .select({ hostelId: hostelWardens.hostelId })
      .from(hostelWardens)
      .where(eq(hostelWardens.wardenId, wardenId))
      .limit(1);
    if (!row) throw new NotFoundException('You are not assigned to any hostel');
    const [hostel] = await this.db.select().from(hostels).where(eq(hostels.id, row.hostelId)).limit(1);
    return hostel;
  }

  /** List unresolved liveness failures for warden's hostel */
  async getFailures(wardenId: string) {
    const [row] = await this.db
      .select({ hostelId: hostelWardens.hostelId })
      .from(hostelWardens)
      .where(eq(hostelWardens.wardenId, wardenId))
      .limit(1);
    if (!row) throw new ForbiddenException('Warden not assigned to any hostel');

    const failures = await this.db
      .select({
        id: livenessFailures.id,
        studentId: livenessFailures.studentId,
        studentName: users.name,
        rollNumber: users.rollNumber,
        facePhoto: users.facePhoto,
        failedAt: livenessFailures.failedAt,
        resolved: livenessFailures.resolved,
      })
      .from(livenessFailures)
      .innerJoin(users, eq(livenessFailures.studentId, users.id))
      .where(and(
        eq(livenessFailures.hostelId, row.hostelId),
        eq(livenessFailures.resolved, false),
      ))
      .orderBy(desc(livenessFailures.failedAt))
      .limit(50);

    return { hostelId: row.hostelId, failures };
  }

  /** Warden manually marks a student present and resolves the failure */
  async manualMark(wardenId: string, dto: ManualAttendanceDto) {
    // Verify warden is assigned to this hostel
    const [row] = await this.db
      .select({ hostelId: hostelWardens.hostelId })
      .from(hostelWardens)
      .where(and(
        eq(hostelWardens.wardenId, wardenId),
        eq(hostelWardens.hostelId, dto.hostelId),
      ))
      .limit(1);
    if (!row) throw new ForbiddenException('Not assigned to this hostel');

    // Verify student exists
    const [student] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, dto.studentId))
      .limit(1);
    if (!student) throw new NotFoundException('Student not found');

    // Verify student assigned to hostel
    const [assignment] = await this.db
      .select({ id: studentHostelAssignments.id })
      .from(studentHostelAssignments)
      .where(and(
        eq(studentHostelAssignments.studentId, dto.studentId),
        eq(studentHostelAssignments.hostelId, dto.hostelId),
      ))
      .limit(1);
    if (!assignment) throw new BadRequestException('Student not assigned to this hostel');

    // Select any window for this hostel; warden override bypasses time check
    const [window] = await this.db
      .select({ id: checkInWindows.id })
      .from(checkInWindows)
      .where(eq(checkInWindows.hostelId, dto.hostelId))
      .limit(1);
    if (!window) throw new BadRequestException('No check-in window configured for this hostel');

    // Insert manual attendance record
    const [record] = await this.db
      .insert(attendanceRecords)
      .values({
        studentId: dto.studentId,
        hostelId: dto.hostelId,
        checkInWindowId: window.id,
        faceMatchScore: 1.0, // warden confirmed identity in person
        livenessPassed: true,
        livenessAction: 'warden-manual',
        deviceLat: 0,
        deviceLng: 0,
        mockLocationFlag: false,
        deviceId: `warden-${wardenId}`,
        gpsSampleSpreadM: 0,
        status: 'present',
      })
      .returning();

    // Resolve all open liveness failures for this student in this hostel
    await this.db
      .update(livenessFailures)
      .set({ resolved: true, resolvedBy: wardenId, resolvedAt: new Date() })
      .where(and(
        eq(livenessFailures.studentId, dto.studentId),
        eq(livenessFailures.hostelId, dto.hostelId),
        eq(livenessFailures.resolved, false),
      ));

    return record;
  }

  // ── Admin: manage warden assignments ───────────────────────────────────────
  async assignWarden(adminId: string, hostelId: string, dto: AssignWardenDto) {
    // Verify warden role
    const [warden] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, dto.wardenId))
      .limit(1);
    if (!warden || warden.role !== 'warden') throw new BadRequestException('User is not a warden');

    await this.db
      .insert(hostelWardens)
      .values({ hostelId, wardenId: dto.wardenId, assignedBy: adminId })
      .onConflictDoNothing();
    return { success: true };
  }

  async removeWarden(hostelId: string, wardenId: string) {
    await this.db
      .delete(hostelWardens)
      .where(and(eq(hostelWardens.hostelId, hostelId), eq(hostelWardens.wardenId, wardenId)));
    return { success: true };
  }

  async listWardens(hostelId: string) {
    return this.db
      .select({
        id: hostelWardens.id,
        wardenId: hostelWardens.wardenId,
        wardenName: users.name,
        wardenEmail: users.email,
        assignedAt: hostelWardens.assignedAt,
      })
      .from(hostelWardens)
      .innerJoin(users, eq(hostelWardens.wardenId, users.id))
      .where(eq(hostelWardens.hostelId, hostelId));
  }

  /** List all users with role=warden (for admin to pick from) */
  async listAllWardens() {
    return this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.role, 'warden'));
  }
}
