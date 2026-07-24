import { Injectable, Inject } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { DB_TOKEN, type Database } from '../db/index.js';
import {
  consentRecords,
  users,
  attendanceRecords,
  studentHostelAssignments,
} from '../db/schema.js';
import type { RecordConsentDto } from './consent.dto.js';

@Injectable()
export class ConsentService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  async recordConsent(
    studentId: string,
    dto: RecordConsentDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const [record] = await this.db
      .insert(consentRecords)
      .values({
        studentId,
        consentVersion: dto.consentVersion,
        ipAddress: ipAddress ?? dto.ipAddress,
        userAgent,
      })
      .returning();
    return record;
  }

  async getConsentStatus(studentId: string) {
    const [record] = await this.db
      .select({
        consentedAt: consentRecords.consentedAt,
        consentVersion: consentRecords.consentVersion,
      })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.studentId, studentId),
          eq(consentRecords.withdrawn, false),
        ),
      )
      .orderBy(desc(consentRecords.consentedAt))
      .limit(1);

    if (!record) {
      return { consented: false };
    }
    return {
      consented: true,
      consentedAt: record.consentedAt,
      version: record.consentVersion,
    };
  }

  async withdrawConsent(studentId: string) {
    await this.db.transaction(async (tx) => {
      // 1. Set withdrawn = true, withdrawnAt = now for active consent records
      await tx
        .update(consentRecords)
        .set({ withdrawn: true, withdrawnAt: new Date() })
        .where(
          and(
            eq(consentRecords.studentId, studentId),
            eq(consentRecords.withdrawn, false),
          ),
        );

      // 2. Delete face embedding
      await tx
        .update(users)
        .set({
          faceEmbedding: null,
          embeddingEnrolledAt: null,
          enrollmentStatus: 'none',
          facePhoto: null,
        })
        .where(eq(users.id, studentId));

      // 3. Delete attendance_records
      await tx
        .delete(attendanceRecords)
        .where(eq(attendanceRecords.studentId, studentId));

      // 4. Delete student_hostel_assignments
      await tx
        .delete(studentHostelAssignments)
        .where(eq(studentHostelAssignments.studentId, studentId));
    });

    return {
      deleted: true,
      message: 'All biometric and personal data deleted per DPDP Act 2023',
    };
  }
}
