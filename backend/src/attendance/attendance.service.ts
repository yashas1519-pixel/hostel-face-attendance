import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { eq, and, sql, desc, gte } from 'drizzle-orm';
import { DB_TOKEN, type Database } from '../db/index.js';
import {
  attendanceRecords,
  checkInWindows,
  hostels,
  studentHostelAssignments,
  users,
} from '../db/schema.js';
import { EnrollmentService } from '../enrollment/enrollment.service.js';
import { pointInPolygon, cosineSimilarity } from '../lib/geo.js';
import type { MarkAttendanceDto } from './attendance.dto.js';

interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly enrollmentService: EnrollmentService,
  ) {}

  async markAttendance(studentId: string, dto: MarkAttendanceDto) {
    // ── Pre-checks: student exists, is enrolled, is assigned to this hostel ──
    const [student] = await this.db
      .select({
        id: users.id,
        faceEmbedding: users.faceEmbedding,
        enrollmentStatus: users.enrollmentStatus,
      })
      .from(users)
      .where(eq(users.id, studentId))
      .limit(1);
    if (!student) throw new NotFoundException('Student not found');
    if (student.enrollmentStatus !== 'approved' || !student.faceEmbedding) {
      throw new BadRequestException('Face enrollment not approved');
    }

    const [assignment] = await this.db
      .select({ id: studentHostelAssignments.id })
      .from(studentHostelAssignments)
      .where(
        and(
          eq(studentHostelAssignments.studentId, studentId),
          eq(studentHostelAssignments.hostelId, dto.hostelId),
        ),
      )
      .limit(1);
    if (!assignment) {
      throw new BadRequestException('Student not assigned to this hostel');
    }

    const [hostel] = await this.db
      .select()
      .from(hostels)
      .where(eq(hostels.id, dto.hostelId))
      .limit(1);
    if (!hostel) throw new NotFoundException('Hostel not found');

    const [window] = await this.db
      .select()
      .from(checkInWindows)
      .where(
        and(
          eq(checkInWindows.id, dto.checkInWindowId),
          eq(checkInWindows.hostelId, dto.hostelId),
          eq(checkInWindows.isActive, true),
        ),
      )
      .limit(1);
    if (!window) throw new NotFoundException('Check-in window not found or inactive');

    let rejected = false;
    let status: 'present' | 'rejected' | 'flagged' = 'present';
    let rejectionReason: string | null = null;

    const reject = (reason: string) => {
      rejected = true;
      status = 'rejected';
      rejectionReason = reason;
    };

    // ── Step 1: Time window check (server clock) ──
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

    if (!window.daysOfWeek.includes(dayOfWeek)) {
      reject('Check-in not available today');
    } else if (currentTime < window.startTime || currentTime > window.endTime) {
      reject(`Outside check-in window (${window.startTime}–${window.endTime})`);
    }

    // ── Step 2: Face match (cosine similarity ≥ 0.65) ──
    const storedEmbedding = this.enrollmentService.decryptEmbedding(
      student.faceEmbedding!,
    );
    const faceMatchScore = cosineSimilarity(dto.embedding, storedEmbedding);
    if (!rejected && faceMatchScore < 0.65) {
      reject(`Face match too low: ${faceMatchScore.toFixed(3)}`);
    }

    // ── Step 3: Liveness + parallax ──
    if (!rejected && !dto.livenessPassed) {
      reject('Liveness check failed');
    }
    if (
      !rejected &&
      (dto.parallaxRatio === undefined || dto.parallaxRatio <= 1.3)
    ) {
      reject(
        `Parallax ratio too low: ${dto.parallaxRatio?.toFixed(2) ?? 'missing'}`,
      );
    }

    // ── Step 4: Geofence (point-in-polygon) ──
    if (!rejected) {
      const polygon = JSON.parse(hostel.boundaryPolygon) as GeoJsonPolygon;
      // ponytail: GeoJSON coordinates[0] is the outer ring
      const ring = polygon.coordinates[0]!;
      if (!pointInPolygon([dto.deviceLng, dto.deviceLat], ring)) {
        reject('Device location outside hostel geofence');
      }
    }

    // ── Step 5: Mock location check ──
    if (!rejected && dto.mockLocationFlag) {
      reject('Mock location detected');
    }

    // ── Step 6: Buddy-punching detector ──
    if (!rejected) {
      const todayStart = new Date(now);
      todayStart.setUTCHours(0, 0, 0, 0);

      const [deviceCount] = await this.db
        .select({ count: sql<number>`count(DISTINCT ${attendanceRecords.studentId})::int` })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.deviceId, dto.deviceId),
            gte(attendanceRecords.markedAt, todayStart),
          ),
        );

      if ((deviceCount?.count ?? 0) >= 3) {
        // ponytail: flag for review, don't auto-reject
        status = 'flagged';
        rejectionReason = 'Device used by 3+ students today — possible buddy-punching';
        this.logger.warn(
          `Buddy-punch flag: device=${dto.deviceId}, student=${studentId}`,
        );
      }
    }

    // ── Step 7: Insert record ──
    const [record] = await this.db
      .insert(attendanceRecords)
      .values({
        studentId,
        hostelId: dto.hostelId,
        checkInWindowId: dto.checkInWindowId,
        faceMatchScore,
        livenessPassed: dto.livenessPassed,
        livenessAction: dto.livenessAction ?? null,
        parallaxRatio: dto.parallaxRatio ?? null,
        deviceLat: dto.deviceLat,
        deviceLng: dto.deviceLng,
        gpsAccuracyM: dto.gpsAccuracyM ?? null,
        wifiBssidMatched: dto.wifiBssidMatched ?? null,
        mockLocationFlag: dto.mockLocationFlag,
        deviceId: dto.deviceId,
        status,
        rejectionReason,
      })
      .returning();

    return record;
  }

  async getHistory(studentId: string, page: number, limit: number) {
    const offset = (page - 1) * limit;

    const rows = await this.db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.studentId, studentId))
      .orderBy(desc(attendanceRecords.markedAt))
      .limit(limit)
      .offset(offset);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.studentId, studentId));

    return { data: rows, total: countRow?.count ?? 0, page, limit };
  }

  async getAdminView(
    hostelId: string | undefined,
    status: string | undefined,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    page: number,
    limit: number,
  ) {
    const offset = (page - 1) * limit;

    // Build where conditions dynamically
    const conditions: ReturnType<typeof eq>[] = [];
    if (hostelId) conditions.push(eq(attendanceRecords.hostelId, hostelId));
    if (status)
      conditions.push(
        eq(
          attendanceRecords.status,
          status as 'present' | 'rejected' | 'flagged',
        ),
      );
    if (dateFrom)
      conditions.push(sql`${attendanceRecords.markedAt} >= ${dateFrom}::timestamptz` as ReturnType<typeof eq>);
    if (dateTo)
      conditions.push(sql`${attendanceRecords.markedAt} <= ${dateTo}::timestamptz` as ReturnType<typeof eq>);

    const where =
      conditions.length > 0
        ? conditions.length === 1
          ? conditions[0]
          : and(...conditions)
        : undefined;

    const query = this.db
      .select({
        id: attendanceRecords.id,
        studentId: attendanceRecords.studentId,
        hostelId: attendanceRecords.hostelId,
        markedAt: attendanceRecords.markedAt,
        faceMatchScore: attendanceRecords.faceMatchScore,
        livenessScore: attendanceRecords.parallaxRatio,
        locationVerified: attendanceRecords.mockLocationFlag,
        status: attendanceRecords.status,
        rejectionReason: attendanceRecords.rejectionReason,
        studentName: users.name,
        rollNumber: users.rollNumber,
        hostelName: hostels.name,
      })
      .from(attendanceRecords)
      .leftJoin(users, eq(attendanceRecords.studentId, users.id))
      .leftJoin(hostels, eq(attendanceRecords.hostelId, hostels.id))
      .orderBy(desc(attendanceRecords.markedAt))
      .limit(limit)
      .offset(offset);

    const rows = where ? await query.where(where) : await query;

    const countQuery = this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(attendanceRecords);

    const [countRow] = where
      ? await countQuery.where(where)
      : await countQuery;

    return { data: rows, total: countRow?.count ?? 0, page, limit };
  }
}
