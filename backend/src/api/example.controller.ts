import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';

@Controller('api')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ExampleApiController {
  @Get('farmer-data')
  @Roles('farmer')
  getFarmerData() {
    return { data: 'This is specific to farmers' };
  }

  @Get('investor-data')
  @Roles('investor')
  getInvestorData() {
    return { data: 'This is specific to investors' };
  }
}
