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
}
