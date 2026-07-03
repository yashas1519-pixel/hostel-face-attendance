import {
  IsString,
  IsNotEmpty,
  IsDateString,
  MaxLength,
  IsOptional,
} from 'class-validator';

export class ApplyLeaveDto {
  @IsDateString()
  fromDate!: string; // 'YYYY-MM-DD'

  @IsDateString()
  toDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class ReviewLeaveDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  adminNote?: string;
}
