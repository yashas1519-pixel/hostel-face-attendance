import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateHostelDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(['boys', 'girls'])
  type!: 'boys' | 'girls';

  @IsString()
  @IsNotEmpty()
  collegeName!: string;

  /** GeoJSON polygon as string — validated structurally in service */
  @IsString()
  @IsNotEmpty()
  boundaryPolygon!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wifiBssids?: string[];
}

export class UpdateHostelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  boundaryPolygon?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wifiBssids?: string[];
}

export class AssignStudentsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  studentIds!: string[];
}
