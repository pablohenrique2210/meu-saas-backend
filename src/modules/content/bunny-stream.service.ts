import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const REFERENCE = new RegExp(`^bunny://([1-9]\\d*)/(${UUID})$`, 'i');
const EMBED = new RegExp(
  `^https://(?:iframe|player)\\.mediadelivery\\.net/embed/([1-9]\\d*)/(${UUID})(?:\\?[^#]*)?$`,
  'i',
);

export function parseBunnyReference(value: string) {
  const match = REFERENCE.exec(value.trim()) ?? EMBED.exec(value.trim());
  return match
    ? { libraryId: match[1], videoId: match[2].toLowerCase() }
    : null;
}

@Injectable()
export class BunnyStreamService {
  async metadata(reference: string) {
    const ids = parseBunnyReference(reference);
    if (!ids)
      throw new BadRequestException(
        'Referência Bunny inválida. Use o endereço Embed da biblioteca.',
      );
    const libraryId = process.env.BUNNY_LIBRARY_ID?.trim();
    const key = (
      process.env.BUNNY_READ_ONLY_API_KEY || process.env.BUNNY_API_KEY
    )?.trim();
    if (!libraryId || !key)
      throw new ServiceUnavailableException(
        'Configure BUNNY_LIBRARY_ID e BUNNY_READ_ONLY_API_KEY no backend Railway.',
      );
    if (ids.libraryId !== libraryId)
      throw new BadRequestException(
        'O vídeo não pertence à biblioteca Bunny configurada.',
      );
    let response: Response;
    try {
      response = await fetch(
        `https://video.bunnycdn.com/library/${libraryId}/videos/${ids.videoId}`,
        {
          headers: { AccessKey: key },
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
        },
      );
    } catch {
      throw new BadGatewayException(
        'Não foi possível consultar o Bunny. Tente novamente.',
      );
    }
    if (response.status === 404)
      throw new NotFoundException('Vídeo não encontrado na biblioteca Bunny.');
    if (!response.ok)
      throw new BadGatewayException(
        'O Bunny recusou a consulta. Verifique a chave da biblioteca no backend.',
      );
    const data = (await response.json().catch(() => null)) as {
      guid?: string;
      videoLibraryId?: number;
      length?: number;
      status?: number;
      availableResolutions?: string;
    } | null;
    if (
      !data ||
      data.guid?.toLowerCase() !== ids.videoId ||
      String(data.videoLibraryId) !== libraryId ||
      !Number.isInteger(data.status) ||
      !Number.isFinite(data.length) ||
      Number(data.length) < 0
    ) {
      throw new BadGatewayException('O Bunny retornou metadados inválidos.');
    }
    if (data.status === 5 || data.status === 8)
      throw new BadRequestException(
        'O Bunny não conseguiu processar este vídeo. Reenvie o arquivo.',
      );
    return {
      ...ids,
      reference: `bunny://${ids.libraryId}/${ids.videoId}`,
      durationSeconds: Math.ceil(Number(data.length)),
      ready:
        data.status === 3 ||
        data.status === 4 ||
        (data.status === 2 && Boolean(data.availableResolutions?.trim())),
    };
  }

  async playback(reference: string) {
    const video = await this.metadata(reference);
    if (!video.ready)
      return { provider: 'bunny' as const, status: 'processing' as const };
    const key = process.env.BUNNY_EMBED_TOKEN_KEY?.trim();
    if (!key)
      throw new ServiceUnavailableException(
        'Configure BUNNY_EMBED_TOKEN_KEY no backend para autorizar a reprodução.',
      );
    const expires = Math.floor(Date.now() / 1000) + 7200;
    const token = createHash('sha256')
      .update(`${key}${video.videoId}${expires}`)
      .digest('hex');
    const url = new URL(
      `https://iframe.mediadelivery.net/embed/${video.libraryId}/${video.videoId}`,
    );
    url.search = new URLSearchParams({
      token,
      expires: String(expires),
      autoplay: 'false',
      preload: 'true',
      responsive: 'true',
    }).toString();
    return {
      provider: 'bunny' as const,
      status: 'ready' as const,
      url: url.toString(),
      expires,
      durationSeconds: video.durationSeconds,
    };
  }
}
