import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { ensureUploadsRootPath, publicUploadUrl } from '../../config/storage';

export interface UploadChunkInput {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  originalName: string;
  mimeType?: string;
}

@Injectable()
export class UploadService {
  async storeChunk(input: UploadChunkInput, chunk?: Express.Multer.File) {
    if (!chunk?.buffer?.length) {
      throw new BadRequestException('O bloco do arquivo não foi recebido.');
    }
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(input.uploadId)) {
      throw new BadRequestException('Identificador de upload inválido.');
    }
    if (
      !Number.isInteger(input.chunkIndex) ||
      !Number.isInteger(input.totalChunks) ||
      input.totalChunks < 1 ||
      input.totalChunks > 10_000 ||
      input.chunkIndex < 0 ||
      input.chunkIndex >= input.totalChunks
    ) {
      throw new BadRequestException('Sequência de blocos inválida.');
    }

    const uploadsRoot = ensureUploadsRootPath();
    const chunksRoot = join(uploadsRoot, '.chunks', input.uploadId);
    await mkdir(chunksRoot, { recursive: true });
    await writeFile(join(chunksRoot, `${input.chunkIndex}.part`), chunk.buffer);

    if (input.chunkIndex !== input.totalChunks - 1) {
      return {
        complete: false,
        chunkIndex: input.chunkIndex,
        totalChunks: input.totalChunks,
      };
    }

    const safeExtension = extname(input.originalName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '')
      .slice(0, 12);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExtension}`;
    const destination = join(uploadsRoot, filename);

    try {
      await writeFile(destination, Buffer.alloc(0));
      for (let index = 0; index < input.totalChunks; index += 1) {
        const buffer = await readFile(join(chunksRoot, `${index}.part`));
        await appendFile(destination, buffer);
      }
      await rm(chunksRoot, { recursive: true, force: true });
    } catch (error) {
      await rm(destination, { force: true }).catch(() => undefined);
      throw new InternalServerErrorException({
        code: 'UPLOAD_ASSEMBLY_FAILED',
        message:
          'Não foi possível concluir o arquivo. Verifique o volume e o espaço disponível no servidor.',
        cause: error instanceof Error ? error.message : undefined,
      });
    }

    return {
      complete: true,
      url: publicUploadUrl(filename),
      originalName: input.originalName,
      mimeType: input.mimeType || chunk.mimetype,
      materialType: this.materialTypeFor(
        input.mimeType || chunk.mimetype,
        input.originalName,
      ),
    };
  }

  materialTypeFor(mimeType: string, originalName: string) {
    const mime = mimeType.toLowerCase();
    const extension = extname(originalName).toLowerCase();
    if (mime.startsWith('image/')) return 'IMAGE';
    if (mime === 'application/pdf' || extension === '.pdf') return 'PDF';
    if (/word|document/.test(mime) || ['.doc', '.docx'].includes(extension))
      return 'WORD';
    if (
      /excel|spreadsheet|csv/.test(mime) ||
      ['.xls', '.xlsx', '.csv'].includes(extension)
    )
      return 'SPREADSHEET';
    if (
      /powerpoint|presentation/.test(mime) ||
      ['.ppt', '.pptx'].includes(extension)
    )
      return 'PRESENTATION';
    if (['.zip', '.rar', '.7z'].includes(extension)) return 'ARCHIVE';
    return 'FILE';
  }
}
