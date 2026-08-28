import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max, Validate, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

@ValidatorConstraint({ name: 'toLedgerGteFromLedger', async: false })
class ToLedgerGteFromLedger implements ValidatorConstraintInterface {
  validate(toLedger: number, args: ValidationArguments): boolean {
    const obj = args.object as BackfillDto;
    return toLedger >= obj.fromLedger;
  }
  defaultMessage(): string {
    return 'toLedger must be greater than or equal to fromLedger';
  }
}

export class BackfillDto {
  @ApiProperty({
    description: 'First ledger sequence to include in the backfill (inclusive)',
    example: 1000,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  fromLedger: number;

  @ApiProperty({
    description: 'Last ledger sequence to include in the backfill (inclusive)',
    example: 1050,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647) // INT4 max — matches Postgres INTEGER column
  @Validate(ToLedgerGteFromLedger)
  toLedger: number;
}

export class BackfillResponseDto {
  @ApiProperty({ description: 'Number of settlement events parsed from the range' })
  processed: number;

  @ApiProperty({ description: 'Number of invoices transitioned to REPAID' })
  settled: number;

  @ApiProperty({ description: 'Number of ledger gap alerts emitted' })
  gaps: number;
}
