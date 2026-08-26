import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { UsersService } from './users.service';

// Documentação: Esta é a rota que o Clerk vai "chamar" pela internet
@Controller('api/webhooks')
export class WebhookController {
  // Documentação: Injetamos o UsersService para podermos salvar no banco de dados
  constructor(private readonly usersService: UsersService) {}

  @Post('clerk')
  @HttpCode(200) // O Clerk precisa receber um "OK 200" para saber que a mensagem chegou
  async handleClerkWebhook(@Body() payload: any) {
    // 1. Verificamos qual foi o evento que o Clerk nos enviou
    const tipoEvento = payload.type;

    // 2. Se o evento for "user.created" (utilizador acabou de se registar)
    if (tipoEvento === 'user.created') {
      // Extraímos os dados importantes que o Clerk enviou
      const clerkId = payload.data.id;
      const email = payload.data.email_addresses[0].email_address;
      const primeiroNome = payload.data.first_name || '';
      const ultimoNome = payload.data.last_name || '';
      const nomeCompleto = `${primeiroNome} ${ultimoNome}`.trim();

      // 3. Chamamos o Prisma para salvar o novo colaborador na base de dados
      // Dica: Como estamos num sistema Multi-Tenant, provisoriamente vamos usar um ID fixo.
      // Mais tarde, o RH pode enviar convites com o ID da empresa embutido.
      try {
        await this.usersService.createFromWebhook({
          id: clerkId,
          email: email,
          name: nomeCompleto,
          companyId: 'ID_DA_EMPRESA_AQUI', // <-- Substituir pela lógica da empresa real depois
          role: 'USER',
        });

        console.log(`✅ Novo utilizador captado com sucesso: ${email}`);
      } catch (error) {
        console.error(`❌ Erro ao salvar utilizador no Prisma:`, error);
      }
    }

    // Retornamos sucesso para o Clerk parar de tentar enviar a mensagem
    return { success: true };
  }
}
