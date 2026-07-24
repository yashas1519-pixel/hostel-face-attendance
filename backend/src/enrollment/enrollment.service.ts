import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, sql, desc } from 'drizzle-orm';
import { DB_TOKEN, type Database } from '../db/index.js';
import { users } from '../db/schema.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import type { SubmitEnrollmentDto } from './enrollment.dto.js';

@Injectable()
export class EnrollmentService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  async submit(studentId: string, dto: SubmitEnrollmentDto) {
    const [student] = await this.db
      .select({ id: users.id, enrollmentStatus: users.enrollmentStatus })
      .from(users)
      .where(eq(users.id, studentId))
      .limit(1);
    if (!student) throw new NotFoundException('Student not found');
    if (student.enrollmentStatus === 'approved') {
      throw new BadRequestException('Enrollment already approved');
    }

    // Convert float array → Float32Array → Buffer → encrypt → store as bytea
    const raw = Buffer.from(new Float32Array(dto.embedding).buffer);
    const encrypted = encrypt(raw);

    await this.db
      .update(users)
      .set({
        faceEmbedding: encrypted,
        enrollmentStatus: 'pending',
        embeddingEnrolledAt: new Date(),
        // ponytail: store only a compressed thumbnail (not full image) for admin review
        // Full raw images are never persisted — only the encrypted embedding is used for matching
        ...(dto.facePhoto ? { facePhoto: dto.facePhoto.slice(0, 50_000) } : {}), // cap at ~50KB
      })
      .where(eq(users.id, studentId));

    return { status: 'pending' };
  }

  async getStatus(studentId: string) {
    const [student] = await this.db
      .select({
        enrollmentStatus: users.enrollmentStatus,
        embeddingEnrolledAt: users.embeddingEnrolledAt,
      })
      .from(users)
      .where(eq(users.id, studentId))
      .limit(1);
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  async approve(studentId: string) {
    const [student] = await this.db
      .select({ id: users.id, enrollmentStatus: users.enrollmentStatus })
      .from(users)
      .where(eq(users.id, studentId))
      .limit(1);
    if (!student) throw new NotFoundException('Student not found');
    if (student.enrollmentStatus !== 'pending') {
      throw new BadRequestException('Only pending enrollments can be approved');
    }

    await this.db
      .update(users)
      .set({ enrollmentStatus: 'approved' })
      .where(eq(users.id, studentId));
    return { status: 'approved' };
  }

  async reject(studentId: string) {
    const [student] = await this.db
      .select({ id: users.id, enrollmentStatus: users.enrollmentStatus })
      .from(users)
      .where(eq(users.id, studentId))
      .limit(1);
    if (!student) throw new NotFoundException('Student not found');
    if (student.enrollmentStatus !== 'pending') {
      throw new BadRequestException('Only pending enrollments can be rejected');
    }

    await this.db
      .update(users)
      .set({ enrollmentStatus: 'rejected', faceEmbedding: null })
      .where(eq(users.id, studentId));
    return { status: 'rejected' };
  }

  /** Decrypt stored embedding back to float array — used by attendance service */
  decryptEmbedding(encrypted: Buffer): number[] {
    const raw = decrypt(encrypted);
    return Array.from(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
  }

  async list(status: string | undefined, page: number, limit: number) {
    const offset = (page - 1) * limit;

    const whereClause = status
      ? sql`role = 'student' AND enrollment_status = ${status}`
      : sql`role = 'student' AND enrollment_status != 'none'`;

    const rows = await this.db
      .select({
        id: users.id,
        studentId: users.id,
        studentName: users.name,
        rollNumber: users.rollNumber,
        status: users.enrollmentStatus,
        submittedAt: users.embeddingEnrolledAt,
        facePhoto: users.facePhoto,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.embeddingEnrolledAt))
      .limit(limit)
      .offset(offset);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(whereClause);

    return { data: rows, total: countRow?.count ?? 0, page, limit };
  }
}
