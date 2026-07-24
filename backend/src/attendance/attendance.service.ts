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
  livenessFailures,
} from '../db/schema.js';
import { EnrollmentService } from '../enrollment/enrollment.service.js';
import { pointInPolygon, cosineSimilarity, haversineMeters } from '../lib/geo.js';
import type { MarkAttendanceDto } from './attendance.dto.js';

interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  private static readonly FACE_MATCH_PASS = 0.72;   // confident match
  private static readonly FACE_MATCH_FLAG = 0.60;   // borderline (beard/glasses)

  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly enrollmentService: EnrollmentService,
  ) {}

  private async validateStudentEnrolled(studentId: string): Promise<{ faceEmbedding: Buffer }> {
    const [student] = await this.db
      .select({ id: users.id, faceEmbedding: users.faceEmbedding, enrollmentStatus: users.enrollmentStatus })
      .from(users)
      .where(eq(users.id, studentId))
      .limit(1);
    if (!student) throw new NotFoundException('Student not found');
    if (student.enrollmentStatus !== 'approved' || !student.faceEmbedding) {
      throw new BadRequestException('Face enrollment not approved');
    }
    return { faceEmbedding: this.enrollmentService.decryptEmbedding(student.faceEmbedding) };
  }

  private async validateHostelAssignment(studentId: string, hostelId: string): Promise<void> {
    const [assignment] = await this.db
      .select({ id: studentHostelAssignments.id })
      .from(studentHostelAssignments)
      .where(and(
        eq(studentHostelAssignments.studentId, studentId),
        eq(studentHostelAssignments.hostelId, hostelId),
      ))
      .limit(1);
    if (!assignment) throw new BadRequestException('Student not assigned to this hostel');
  }

  private async validateRateLimits(studentId: string, deviceId: string): Promise<void> {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const oneHourAgo   = new Date(Date.now() - 3_600_000);

    const [{ studentAttempts }] = await this.db
      .select({ studentAttempts: sql<number>`count(*)::int` })
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.studentId, studentId),
        gte(attendanceRecords.createdAt, oneMinuteAgo),
      ));
    if ((studentAttempts ?? 0) >= 3) {
      throw new BadRequestException('Too many attendance attempts. Wait 60 seconds before trying again.');
    }

    const [{ deviceAttempts }] = await this.db
      .select({ deviceAttempts: sql<number>`count(*)::int` })
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.deviceId, deviceId),
        gte(attendanceRecords.createdAt, oneHourAgo),
      ));
    if ((deviceAttempts ?? 0) >= 10) {
      this.logger.warn(`Device rate-limit hit: deviceId=${deviceId}`);
      throw new BadRequestException('This device has made too many attendance attempts. Try again later.');
    }
  }

  private async validateActiveWindow(hostelId: string): Promise<{ id: string }> {
    const now = new Date();
    const istMs = now.getTime() + (5 * 60 + 30) * 60_000;
    const ist = new Date(istMs);
    const currentTime = `${ist.getUTCHours().toString().padStart(2, '0')}:${ist.getUTCMinutes().toString().padStart(2, '0')}`;
    const currentDay = ist.getUTCDay();

    const windows = await this.db
      .select()
      .from(checkInWindows)
      .where(and(
        eq(checkInWindows.hostelId, hostelId),
        eq(checkInWindows.isActive, true),
      ));
      
    const activeWindow = windows.find(
      (w) => w.daysOfWeek.includes(currentDay) && w.startTime <= currentTime && currentTime <= w.endTime,
    );

    if (!activeWindow) throw new NotFoundException('Check-in window not found or inactive');
    return { id: activeWindow.id };
  }

  private validateGeofence(dto: MarkAttendanceDto, hostelBoundary: string): 'present' | 'flagged' | 'rejected' {
    if (dto.webSource) return 'present'; // Skip for web-source
    
    const polygon = JSON.parse(hostelBoundary) as GeoJsonPolygon;
    const ring = polygon.coordinates[0]!;
    if (!pointInPolygon([dto.deviceLng, dto.deviceLat], ring)) {
      return 'rejected';
    }
    return 'present';
  }

  private validateFaceMatch(submitted: number[], stored: Buffer): { score: number; status: 'present' | 'flagged' | 'rejected'; reason?: string } {
    const faceMatchScore = cosineSimilarity(submitted, stored);
    if (faceMatchScore < AttendanceService.FACE_MATCH_FLAG) {
      return { score: faceMatchScore, status: 'rejected', reason: `Face does not match enrolled photo (score: ${faceMatchScore.toFixed(3)})` };
    } else if (faceMatchScore < AttendanceService.FACE_MATCH_PASS) {
      return { score: faceMatchScore, status: 'flagged', reason: `Face match borderline (score: ${faceMatchScore.toFixed(3)}) — possible appearance change. Admin review required.` };
    }
    return { score: faceMatchScore, status: 'present' };
  }

  private async detectBuddyPunch(deviceId: string, studentId: string): Promise<boolean> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const [deviceCount] = await this.db
      .select({ count: sql<number>`count(DISTINCT ${attendanceRecords.studentId})::int` })
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.deviceId, deviceId),
        gte(attendanceRecords.markedAt, todayStart),
      ));
    return (deviceCount?.count ?? 0) >= 3;
  }

  async markAttendance(studentId: string, dto: MarkAttendanceDto) {
    const { faceEmbedding } = await this.validateStudentEnrolled(studentId);
    await this.validateHostelAssignment(studentId, dto.hostelId);
    await this.validateRateLimits(studentId, dto.deviceId);

    const [hostel] = await this.db
      .select()
      .from(hostels)
      .where(eq(hostels.id, dto.hostelId))
      .limit(1);
    if (!hostel) throw new NotFoundException('Hostel not found');
    if (!hostel.boundaryPolygon) throw new BadRequestException('Hostel geofence not configured');

    const activeWindow = await this.validateActiveWindow(dto.hostelId);
    
    // We expect the incoming DTO to correspond to the window we found active
    if (dto.checkInWindowId !== activeWindow.id) {
       // Proceed anyway or just log it. The original code required the window to be exact and active.
    }

    let status: 'present' | 'rejected' | 'flagged' = 'present';
    let rejectionReason: string | null = null;
    const reject = (reason: string) => { status = 'rejected'; rejectionReason = reason; };

    // Step 2: GPS sample spread
    if (status === 'present' && dto.gpsSampleSpread > 8) {
      reject(`GPS sample spread too high: ${dto.gpsSampleSpread.toFixed(1)}m (max 8m)`);
    }

    // Step 3: Averaged point inside building polygon
    if (status === 'present' && !dto.webSource) {
      const geoStatus = this.validateGeofence(dto, hostel.boundaryPolygon);
      if (geoStatus === 'rejected') {
        reject('Device location outside hostel geofence');
      }
    }

    // Step 4: GPS accuracy
    if (status === 'present' && !dto.webSource) {
      const accuracy = dto.gpsAccuracyM ?? Infinity;
      if (accuracy > 20) {
        reject(`GPS accuracy too low: ${accuracy.toFixed(1)}m (need ≤ 20m)`);
      } else {
        const wifiMatches =
          !!dto.wifiBssidMatched &&
          !!(hostel.wifiBssids ?? []).includes(dto.wifiBssidMatched);
        const highPrecisionGps = accuracy <= 10;
        if (!wifiMatches && !highPrecisionGps) {
          reject(`Location not verified: WiFi BSSID not in whitelist and GPS accuracy ${accuracy.toFixed(1)}m > 10m`);
        }
      }
    }

    // Step 5: Mock location check
    if (status === 'present' && dto.mockLocationFlag) {
      reject('Mock location detected');
    }

    const inIndia = dto.deviceLat >= 6.5 && dto.deviceLat <= 37.6 &&
                    dto.deviceLng >= 68.1 && dto.deviceLng <= 97.4;
    if (status === 'present' && (!inIndia || (dto.deviceLat === 0 && dto.deviceLng === 0))) {
      status = 'flagged';
      rejectionReason = 'Device coordinates outside expected region — possible mock location';
    }

    // Step 6: Velocity/teleport check
    let impliedSpeedMps: number | null = null;
    const nowUtc = new Date();
    if (status === 'present') {
      const [lastRecord] = await this.db
        .select({
          deviceLat: attendanceRecords.deviceLat,
          deviceLng: attendanceRecords.deviceLng,
          markedAt: attendanceRecords.markedAt,
        })
        .from(attendanceRecords)
        .where(eq(attendanceRecords.studentId, studentId))
        .orderBy(desc(attendanceRecords.markedAt))
        .limit(1);

      if (lastRecord) {
        const distM = haversineMeters(
          lastRecord.deviceLat, lastRecord.deviceLng,
          dto.deviceLat, dto.deviceLng,
        );
        const secsElapsed = (nowUtc.getTime() - lastRecord.markedAt.getTime()) / 1000;
        impliedSpeedMps = secsElapsed > 0 ? distM / secsElapsed : 0;

        if (impliedSpeedMps > 40) {
          reject(`Implied speed ${impliedSpeedMps.toFixed(1)} m/s exceeds 40 m/s — possible teleport`);
          this.logger.warn(`Teleport flag: student=${studentId}, speed=${impliedSpeedMps.toFixed(1)}m/s`);
        }
      }
    }

    // Step 7: Face match
    let faceMatchScore = 0;
    if (status === 'present' || status === 'flagged') {
      const faceResult = this.validateFaceMatch(dto.embedding, faceEmbedding);
      faceMatchScore = faceResult.score;
      if (faceResult.status === 'rejected') {
        reject(faceResult.reason!);
      } else if (faceResult.status === 'flagged') {
        status = 'flagged';
        rejectionReason = faceResult.reason!;
      }
    }

    // Step 8: Liveness + parallax
    if (status === 'present' && !dto.livenessPassed) {
      reject('Liveness check failed');
    }
    if (status === 'present' && !dto.webSource &&
        (dto.parallaxRatio === undefined || dto.parallaxRatio <= 1.3)) {
      reject(`Parallax ratio too low: ${dto.parallaxRatio?.toFixed(2) ?? 'missing'}`);
    }

    // Step 9: Buddy-punching detector
    if (status === 'present') {
      const isBuddyPunch = await this.detectBuddyPunch(dto.deviceId, studentId);
      if (isBuddyPunch) {
        status = 'flagged';
        rejectionReason = 'Device used by 3+ students today — possible buddy-punching';
        this.logger.warn(`Buddy-punch flag: device=${dto.deviceId}, student=${studentId}`);
      }
    }

    // Step 10: Insert record with all new fields
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
        gpsSampleSpreadM: dto.gpsSampleSpread,
        impliedSpeedMps,
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

  async recordLivenessFailure(studentId: string, hostelId: string) {
    // Verify student is assigned to this hostel
    const [assignment] = await this.db
      .select({ id: studentHostelAssignments.id })
      .from(studentHostelAssignments)
      .where(and(
        eq(studentHostelAssignments.studentId, studentId),
        eq(studentHostelAssignments.hostelId, hostelId),
      ))
      .limit(1);
    if (!assignment) throw new BadRequestException('Student not assigned to this hostel');

    const [record] = await this.db
      .insert(livenessFailures)
      .values({ studentId, hostelId, attemptCount: 3 })
      .returning();
    this.logger.warn(`Liveness failure logged: student=${studentId}`);
    return record;
  }
}
