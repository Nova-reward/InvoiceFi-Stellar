import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Controller('auth')
export class AuthController {
  @UseGuards(AuthGuard('jwt'))
  @Get('profile')
  getProfile(@Request() req) {
    // req.user is populated by JwtStrategy
    return {
      userId: req.user.userId,
      username: req.user.username,
      role: req.user.role, // 'farmer' | 'investor'
    };
  }
}
