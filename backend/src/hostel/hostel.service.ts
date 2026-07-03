import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { DB_TOKEN, type Database } from '../db/index.js';
import { hostels, studentHostelAssignments, users, checkInWindows } from '../db/schema.js';
import type {
  CreateHostelDto,
  UpdateHostelDto,
  AssignStudentsDto,
} from './hostel.dto.js';
import type { CreateWindowDto, UpdateWindowDto } from './window.dto.js';

@Injectable()
export class HostelService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  async create(dto: CreateHostelDto, adminId: string) {
    // ponytail: basic GeoJSON structure check — skip full RFC 7946 validation
    try {
      const parsed = JSON.parse(dto.boundaryPolygon) as { type?: string };
      if (parsed.type !== 'Polygon') throw new Error();
    } catch {
      throw new BadRequestException('boundaryPolygon must be a valid GeoJSON Polygon');
    }

    const [hostel] = await this.db
      .insert(hostels)
      .values({
        name: dto.name,
        type: dto.type,
        collegeName: dto.collegeName,
        boundaryPolygon: dto.boundaryPolygon,
        wifiBssids: dto.wifiBssids ?? null,
        createdBy: adminId,
      })
      .returning();
    return hostel;
  }

  async list(collegeName: string, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const rows = await this.db
      .select()
      .from(hostels)
      .where(eq(hostels.collegeName, collegeName))
      .limit(limit)
      .offset(offset);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(hostels)
      .where(eq(hostels.collegeName, collegeName));

    return { data: rows, total: countRow?.count ?? 0, page, limit };
  }

  async update(id: string, dto: UpdateHostelDto) {
    if (dto.boundaryPolygon) {
      try {
        const parsed = JSON.parse(dto.boundaryPolygon) as { type?: string };
        if (parsed.type !== 'Polygon') throw new Error();
      } catch {
        throw new BadRequestException('boundaryPolygon must be a valid GeoJSON Polygon');
      }
    }

    const [hostel] = await this.db
      .update(hostels)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.boundaryPolygon !== undefined && {
          boundaryPolygon: dto.boundaryPolygon,
        }),
        ...(dto.wifiBssids !== undefined && { wifiBssids: dto.wifiBssids }),
      })
      .where(eq(hostels.id, id))
      .returning();

    if (!hostel) throw new NotFoundException('Hostel not found');
    return hostel;
  }

  async assignStudents(hostelId: string, dto: AssignStudentsDto, adminId: string) {
    // Verify hostel exists
    const [hostel] = await this.db
      .select({ id: hostels.id })
      .from(hostels)
      .where(eq(hostels.id, hostelId))
      .limit(1);
    if (!hostel) throw new NotFoundException('Hostel not found');

    // Verify all students exist and are students
    const studentRows = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(
        and(
          sql`${users.id} = ANY(${dto.studentIds}::uuid[])`,
          eq(users.role, 'student'),
        ),
      );
    if (studentRows.length !== dto.studentIds.length) {
      throw new BadRequestException('Some IDs are not valid students');
    }

    const values = dto.studentIds.map((sid) => ({
      studentId: sid,
      hostelId,
      assignedBy: adminId,
    }));

    await this.db.insert(studentHostelAssignments).values(values);
    return { assigned: dto.studentIds.length };
  }

  // ── Check-in Windows ────────────────────────────────────────

  async listWindows(hostelId: string) {
    return this.db
      .select()
      .from(checkInWindows)
      .where(eq(checkInWindows.hostelId, hostelId));
  }

  async createWindow(hostelId: string, dto: CreateWindowDto) {
    const [hostel] = await this.db
      .select({ id: hostels.id })
      .from(hostels)
      .where(eq(hostels.id, hostelId))
      .limit(1);
    if (!hostel) throw new NotFoundException('Hostel not found');

    const [window] = await this.db
      .insert(checkInWindows)
      .values({
        hostelId,
        name: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        daysOfWeek: dto.daysOfWeek,
        isActive: dto.isActive ?? true,
      })
      .returning();
    return window;
  }

  async updateWindow(hostelId: string, windowId: string, dto: UpdateWindowDto) {
    const [window] = await this.db
      .update(checkInWindows)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.endTime !== undefined && { endTime: dto.endTime }),
        ...(dto.daysOfWeek !== undefined && { daysOfWeek: dto.daysOfWeek }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      })
      .where(and(eq(checkInWindows.id, windowId), eq(checkInWindows.hostelId, hostelId)))
      .returning();
    if (!window) throw new NotFoundException('Window not found');
    return window;
  }

  async deleteWindow(hostelId: string, windowId: string) {
    await this.db
      .delete(checkInWindows)
      .where(and(eq(checkInWindows.id, windowId), eq(checkInWindows.hostelId, hostelId)));
    return { deleted: true };
  }

  async getActiveWindow(hostelId: string) {
    const now = new Date();
    // HH:MM in server local time
    const hh = now.getUTCHours().toString().padStart(2, '0');
    const mm = now.getUTCMinutes().toString().padStart(2, '0');
    const currentTime = `${hh}:${mm}`;
    const currentDay = now.getUTCDay(); // 0=Sun..6=Sat

    const windows = await this.db
      .select()
      .from(checkInWindows)
      .where(
        and(
          eq(checkInWindows.hostelId, hostelId),
          eq(checkInWindows.isActive, true),
        ),
      );

    const active = windows.find(
      (w) =>
        w.daysOfWeek.includes(currentDay) &&
        w.startTime <= currentTime &&
        currentTime <= w.endTime,
    );

    return active ?? null;
  }
}
