import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Inject,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { hash, compare } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { DB_TOKEN, type Database } from '../db/index.js';
import { users, studentHostelAssignments, refreshTokens } from '../db/schema.js';
import type { RegisterDto, LoginDto } from './auth.dto.js';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.role === 'student' && !dto.rollNumber) {
      throw new BadRequestException('roll_number is required for students');
    }
    const existing = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);
    if (existing.length > 0) throw new ConflictException('Email already registered');

    const passwordHash = await hash(dto.password, 12); // cost 12 for registration
    const [user] = await this.db
      .insert(users)
      .values({ email: dto.email, passwordHash, name: dto.name, role: dto.role, rollNumber: dto.rollNumber ?? null, collegeName: dto.collegeName })
      .returning({ id: users.id, email: users.email, role: users.role });

    return this.issueTokens(user!);
  }

  async login(dto: LoginDto) {
    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        passwordHash: users.passwordHash,
        loginAttempts: users.loginAttempts,
        lockedUntil: users.lockedUntil,
      })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);

    // Always respond with same message to prevent user enumeration
    if (!user) throw new UnauthorizedException('Invalid credentials');

    // Account lockout check
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMin = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new ForbiddenException(`Account locked. Try again in ${remainingMin} minute(s).`);
    }

    const valid = await compare(dto.password, user.passwordHash);

    if (!valid) {
      const attempts = user.loginAttempts + 1;
      const shouldLock = attempts >= MAX_ATTEMPTS;
      await this.db
        .update(users)
        .set({
          loginAttempts: attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : null,
        })
        .where(eq(users.id, user.id));

      if (shouldLock) {
        this.logger.warn(`Account locked after ${MAX_ATTEMPTS} failed attempts: userId=${user.id}`);
        throw new ForbiddenException('Too many failed attempts. Account locked for 15 minutes.');
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    // Success — reset lockout counter
    if (user.loginAttempts > 0) {
      await this.db.update(users).set({ loginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
    }

    const { passwordHash: _, ...safe } = user;
    return this.issueTokens(safe);
  }

  async refresh(rawToken: string) {
    const tokenHash = sha256(rawToken);
    const [rt] = await this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!rt) throw new UnauthorizedException('Invalid or expired refresh token');

    // Rotate: revoke old, issue new pair
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, rt.id));

    const [user] = await this.db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, rt.userId))
      .limit(1);
    if (!user) throw new UnauthorizedException('User not found');

    return this.issueTokens(user);
  }

  async logout(rawToken: string) {
    const tokenHash = sha256(rawToken);
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return { message: 'Logged out' };
  }

  async getMe(userId: string) {
    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        rollNumber: users.rollNumber,
        role: users.role,
        collegeName: users.collegeName,
        enrollmentStatus: users.enrollmentStatus,
        embeddingEnrolledAt: users.embeddingEnrolledAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException('User not found');

    if (user.role === 'student') {
      const [assignment] = await this.db
        .select({ hostelId: studentHostelAssignments.hostelId })
        .from(studentHostelAssignments)
        .where(eq(studentHostelAssignments.studentId, userId))
        .limit(1);
      return { ...user, hostelId: assignment?.hostelId ?? null };
    }
    return user;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private signAccessToken(user: { id: string; email: string; role: string }) {
    return this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: '15m' }, // short-lived access token
    );
  }

  private async issueTokens(user: { id: string; email: string; role: string }) {
    const accessToken = this.signAccessToken(user);

    // Generate cryptographically random refresh token (stored as SHA-256 hash)
    const rawRefresh = randomBytes(48).toString('hex');
    const tokenHash = sha256(rawRefresh);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.db.insert(refreshTokens).values({ userId: user.id, tokenHash, expiresAt });

    // Never log the raw refresh token
    this.logger.log(`Tokens issued for userId=${user.id} role=${user.role}`);

    return { accessToken, refreshToken: rawRefresh, user };
  }
}
