import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

export class SubmitEnrollmentDto {
  /** Face embedding as float array from client-side face detection */
  @IsArray()
  @IsNumber({}, { each: true })
  embedding!: number[];

  /** Base64 JPEG snapshot taken during enrollment (optional) */
  @IsOptional()
  @IsString()
  facePhoto?: string;
}
