import { IsString, IsOptional } from 'class-validator';

export class RecordConsentDto {
  @IsString()
  consentVersion: string = '1.0';

  @IsOptional()
  @IsString()
  ipAddress?: string;
}
