import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  real,
  doublePrecision,
  integer,
  pgEnum,
  customType,
} from 'drizzle-orm/pg-core';

// ponytail: custom bytea type — drizzle-orm doesn't ship one for pg-core
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const roleEnum = pgEnum('role', ['student', 'admin']);
export const enrollmentStatusEnum = pgEnum('enrollment_status', [
  'none',
  'pending',
  'approved',
  'rejected',
]);
export const hostelTypeEnum = pgEnum('hostel_type', ['boys', 'girls']);
export const attendanceStatusEnum = pgEnum('attendance_status', [
  'present',
  'rejected',
  'flagged',
]);

// ── Users ──────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  rollNumber: text('roll_number').unique(),
  role: roleEnum('role').notNull(),
  collegeName: text('college_name').notNull(),
  faceEmbedding: bytea('face_embedding'),
  embeddingEnrolledAt: timestamp('embedding_enrolled_at', { withTimezone: true }),
  enrollmentStatus: enrollmentStatusEnum('enrollment_status')
    .notNull()
    .default('none'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

// ── Hostels ────────────────────────────────────────────────────────────
export const hostels = pgTable('hostels', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  type: hostelTypeEnum('type').notNull(),
  collegeName: text('college_name').notNull(),
  // ponytail: store GeoJSON as text — skip PostGIS for MVP
  boundaryPolygon: text('boundary_polygon').notNull(),
  wifiBssids: text('wifi_bssids').array(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

// ── Check-in Windows ──────────────────────────────────────────────────
export const checkInWindows = pgTable('check_in_windows', {
  id: uuid('id').defaultRandom().primaryKey(),
  hostelId: uuid('hostel_id')
    .notNull()
    .references(() => hostels.id),
  name: text('name').notNull(),
  startTime: text('start_time').notNull(), // 'HH:MM'
  endTime: text('end_time').notNull(),
  daysOfWeek: integer('days_of_week').array().notNull(), // 0=Sun..6=Sat
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

// ── Student ↔ Hostel Assignments ──────────────────────────────────────
export const studentHostelAssignments = pgTable('student_hostel_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  hostelId: uuid('hostel_id')
    .notNull()
    .references(() => hostels.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  assignedBy: uuid('assigned_by')
    .notNull()
    .references(() => users.id),
});

// ── Attendance Records ────────────────────────────────────────────────
export const attendanceRecords = pgTable('attendance_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  hostelId: uuid('hostel_id')
    .notNull()
    .references(() => hostels.id),
  checkInWindowId: uuid('check_in_window_id')
    .notNull()
    .references(() => checkInWindows.id),
  markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
  faceMatchScore: real('face_match_score').notNull(),
  livenessPassed: boolean('liveness_passed').notNull(),
  livenessAction: text('liveness_action'),
  parallaxRatio: real('parallax_ratio'),
  deviceLat: doublePrecision('device_lat').notNull(),
  deviceLng: doublePrecision('device_lng').notNull(),
  gpsAccuracyM: real('gps_accuracy_m'),
  // spec §6: building_id maps to hostelId in our schema (hostel IS the building)
  gpsSampleSpreadM: real('gps_sample_spread_m'),   // max pairwise distance of GPS samples
  impliedSpeedMps: real('implied_speed_mps'),       // haversine(prev→curr) / secs_elapsed
  wifiBssidMatched: text('wifi_bssid_matched'),
  mockLocationFlag: boolean('mock_location_flag').notNull().default(false),
  deviceId: text('device_id').notNull(),
  status: attendanceStatusEnum('status').notNull(),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
