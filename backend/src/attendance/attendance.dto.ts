import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class MarkAttendanceDto {
  @IsUUID()
  hostelId!: string;

  @IsUUID()
  checkInWindowId!: string;

  /** Face embedding captured at attendance time */
  @IsArray()
  @IsNumber({}, { each: true })
  embedding!: number[];

  @IsBoolean()
  livenessPassed!: boolean;

  @IsOptional()
  @IsString()
  livenessAction?: string;

  @IsOptional()
  @IsNumber()
  parallaxRatio?: number;

  @IsNumber()
  deviceLat!: number;

  @IsNumber()
  deviceLng!: number;

  @IsOptional()
  @IsNumber()
  gpsAccuracyM?: number;

  @IsOptional()
  @IsString()
  wifiBssidMatched?: string;

  @IsBoolean()
  mockLocationFlag!: boolean;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  /**
   * Max pairwise haversine distance (metres) across the client's GPS samples.
   * Client samples location every ~500ms for ~3s and reports the spread.
   * Server rejects if > 8m (spec §2).
   */
  @IsNumber()
  gpsSampleSpread!: number;

  /**
   * Client-estimated speed (m/s) since last known location.
   * Optional — server ALWAYS recomputes this from DB for the authoritative check.
   * Included here for audit logging only.
   */
  @IsOptional()
  @IsNumber()
  impliedSpeed?: number;

  /** True when submitted from web browser — skips GPS polygon and parallax checks */
  @IsOptional()
  @IsBoolean()
  webSource?: boolean;
}
