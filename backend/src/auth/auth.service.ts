import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, compare } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DB_TOKEN, type Database } from '../db/index.js';
import { users } from '../db/schema.js';
import type { RegisterDto, LoginDto } from './auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly jwt: JwtService,
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

    const passwordHash = await hash(dto.password, 10);
    const [user] = await this.db
      .insert(users)
      .values({
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: dto.role,
        rollNumber: dto.rollNumber ?? null,
        collegeName: dto.collegeName,
      })
      .returning({ id: users.id, email: users.email, role: users.role });

    return { token: this.signToken(user!), user };
  }

  async login(dto: LoginDto) {
    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const { passwordHash: _, ...safe } = user;
    return { token: this.signToken(safe), user: safe };
  }

  private signToken(user: { id: string; email: string; role: string }) {
    return this.jwt.sign({ sub: user.id, email: user.email, role: user.role });
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
    return user;
  }
}
