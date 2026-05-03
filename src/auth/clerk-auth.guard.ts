import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { clerkClient } from '@clerk/clerk-sdk-node';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      this.logger.warn('❌ Nenhum token foi enviado no cabeçalho (Header vazio).');
      throw new UnauthorizedException('Acesso negado: Token não encontrado.');
    }

    const token = authHeader.replace('Bearer ', '');

    // 🕵️‍♂️ O nosso espião: Verifica se o NestJS está a conseguir ler o .env
    this.logger.log(`🔑 A Secret Key está carregada no Backend? ${!!process.env.CLERK_SECRET_KEY ? 'SIM' : 'NÃO (Vazio!)'}`);

    try {
      const decodedToken = await clerkClient.verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      } as any);

      request.user = { id: decodedToken.sub };
      this.logger.log(`✅ Token válido! Utilizador autorizado: ${decodedToken.sub}`);
      return true;

    } catch (error) {
      // 🕵️‍♂️ O espião revela o motivo exato do erro do Clerk!
      this.logger.error(`🚨 Falha na validação do Clerk: ${error.message}`);
      throw new UnauthorizedException('Acesso negado: Token inválido.');
    }
  }
}