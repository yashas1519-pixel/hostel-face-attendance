import { IsUUID } from 'class-validator';

export class AssignWardenDto {
  @IsUUID()
  wardenId!: string;
}

export class ManualAttendanceDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  hostelId!: string;
}
