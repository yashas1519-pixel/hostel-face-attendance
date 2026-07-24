import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { DB_TOKEN, type Database } from '../db/index.js';
import { attendanceRecords, consentRecords } from '../db/schema.js';
import { lt, and, eq } from 'drizzle-orm';

@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  onModuleInit() {
    this.logger.log('Initializing retention service interval (daily purge)');
    // Initial run after a short delay
    setTimeout(() => this.purgeData().catch(e => this.logger.error('Purge error', e)), 5000);
    // Run daily
    setInterval(() => {
      this.purgeData().catch(e => this.logger.error('Purge error', e));
    }, 24 * 60 * 60 * 1000);
  }

  private async purgeData() {
    this.logger.log('Starting automated data retention purge...');
    let purgedAttendance = 0;
    let purgedConsent = 0;

    try {
      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

      const deletedAttendance = await this.db.delete(attendanceRecords)
        .where(lt(attendanceRecords.createdAt, threeYearsAgo))
        .returning({ id: attendanceRecords.id });
      
      purgedAttendance = deletedAttendance.length;

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const deletedConsent = await this.db.delete(consentRecords)
        .where(
          and(
            eq(consentRecords.withdrawn, true),
            lt(consentRecords.withdrawnAt, ninetyDaysAgo)
          )
        )
        .returning({ id: consentRecords.id });
      
      purgedConsent = deletedConsent.length;

      this.logger.log(`Data retention purge complete. Purged ${purgedAttendance} attendance records and ${purgedConsent} consent records.`);
    } catch (error) {
      this.logger.error('Failed to purge data for retention policy', error);
      throw error;
    }
  }
}
