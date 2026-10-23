import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  siteId: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5, { message: 'Please describe the change in a few more words.' })
  @MaxLength(2000)
  request: string;
}
