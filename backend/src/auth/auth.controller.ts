import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ConnectWalletDto, AuthResponseDto } from './dto/connect-wallet.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('connect')
  @ApiOperation({ summary: 'Connect wallet and get JWT token' })
  @ApiResponse({ status: 201, description: 'JWT issued', type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  connectWallet(@Body() dto: ConnectWalletDto) {
    return this.authService.connectWallet(dto);
  }
}
