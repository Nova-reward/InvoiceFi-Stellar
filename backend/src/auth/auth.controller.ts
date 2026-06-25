import { Controller, Get, Post, Request, UseGuards, Response as Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { ConnectWalletDto, AuthResponseDto } from './dto/connect-wallet.dto';
import { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('connect-wallet')
  async connectWallet(@Request() req, @Res() res: Response) {
    const dto: ConnectWalletDto = req.body;
    const result = await this.authService.connectWallet(dto);

    // Set JWT token in secure cookie
    res.cookie('token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.json(result);
  }

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

  @Post('logout')
  logout(@Res() res: Response) {
    // Clear the JWT token cookie
    res.clearCookie('token');
    return res.json({ message: 'Logout successful' });
  }
}

