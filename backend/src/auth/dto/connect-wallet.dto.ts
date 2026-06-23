import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export class ConnectWalletDto {
  @ApiProperty({ example: 'GABC...XYZ', description: 'Stellar wallet public key' })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @ApiProperty({ enum: ['FARMER', 'INVESTOR', 'ADMIN'], required: false, default: 'FARMER' })
  @IsEnum(['FARMER', 'INVESTOR', 'ADMIN'])
  @IsOptional()
  role?: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken: string;

  @ApiProperty({ example: 'GABC...XYZ' })
  walletAddress: string;

  @ApiProperty({ enum: ['FARMER', 'INVESTOR', 'ADMIN'] })
  role: string;
}
