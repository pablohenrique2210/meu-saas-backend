import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';


@Controller('companies')
@UseGuards(ClerkAuthGuard) // 👈 Movemos para aqui! Agora TODAS as rotas abaixo estão protegidas.
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

 @Post()
  create(@Body() createCompanyDto: CreateCompanyDto) {
    return this.companiesService.create(createCompanyDto);
  }

@Get()
  findAll() {
    return this.companiesService.findAll();
  }

 // ... (o teu @Post e findAll continuam iguais lá em cima)

  // ... (imports e parte de cima continuam iguais)

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.companiesService.findOne(id); // Tiramos o '+'
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCompanyDto: UpdateCompanyDto) {
    return this.companiesService.update(id, updateCompanyDto); // Tiramos o '+'
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.companiesService.remove(id); // Tiramos o '+'
  }
}