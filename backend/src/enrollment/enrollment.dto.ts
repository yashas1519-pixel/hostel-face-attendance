import { IsArray, IsNumber } from 'class-validator';

export class SubmitEnrollmentDto {
  /** Face embedding as float array from client-side face detection */
  @IsArray()
  @IsNumber({}, { each: true })
  embedding!: number[];
}
