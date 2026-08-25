import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectWalletDto } from './dto/connect-wallet.dto';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async connectWallet(dto: ConnectWalletDto) {
    let user = await this.prisma.user.findUnique({ where: { walletAddress: dto.walletAddress } });

    if (!user) {
      user = await this.prisma.user.create({
        data: { walletAddress: dto.walletAddress, role: (dto.role as any) ?? 'FARMER' },
      });
    }

    const token = this.jwt.sign({ sub: user.id, walletAddress: user.walletAddress, role: user.role });
    return { accessToken: token, walletAddress: user.walletAddress, role: user.role };
  }
}
