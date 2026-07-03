import {
  IsString,
  IsArray,
  IsInt,
  IsBoolean,
  IsOptional,
  Matches,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';

export class CreateWindowDto {
  @IsString()
  name!: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'endTime must be HH:MM' })
  endTime!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateWindowDto {
  @IsString()
  @IsOptional()
  name?: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must be HH:MM' })
  @IsOptional()
  startTime?: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'endTime must be HH:MM' })
  @IsOptional()
  endTime?: string;

  @IsArray()
  @IsOptional()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
