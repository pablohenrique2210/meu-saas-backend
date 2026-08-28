import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureUploadsRootPath, publicUploadUrl } from '../../config/storage';
import { AssetStorageService } from './asset-storage.service';

export interface UploadChunkInput {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  originalName: string;
  mimeType?: string;
}

@Injectable()
export class UploadService {
  constructor(
    private readonly assets: AssetStorageService = new AssetStorageService(),
  ) {}

  async storeFile(file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Nenhum arquivo foi recebido.');
    }
    const safeExtension = extname(file.originalname)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '')
      .slice(0, 12);
    const filename = `${randomUUID()}${safeExtension}`;
    await this.assets.storeBuffer(filename, file.buffer, file.mimetype);
    return this.completedResponse(filename, file.originalname, file.mimetype);
  }

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

    const safeExtension = extname(input.originalName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '')
      .slice(0, 12);
    const filename = `${input.uploadId}${safeExtension}`;
    const uploadsRoot = ensureUploadsRootPath();
    const destination = join(uploadsRoot, filename);
    const sessionRoot = join(uploadsRoot, '.chunks', input.uploadId);
    const stagingPath = join(sessionRoot, 'uploading.tmp');
    const metadataPath = join(sessionRoot, 'metadata.json');

    // Se a resposta final se perdeu na rede, a repetição devolve o mesmo
    // resultado sem remontar nem duplicar o arquivo.
    if (await this.fileExists(destination)) {
      return this.completedUpload(input, chunk, filename);
    }

    await mkdir(sessionRoot, { recursive: true });

    try {
      const metadata = await this.getUploadMetadata(
        input,
        chunk.buffer.length,
        metadataPath,
      );
      const file = await open(
        stagingPath,
        (await this.fileExists(stagingPath)) ? 'r+' : 'w+',
      );
      try {
        // Cada bloco ocupa uma posição fixa. Uma tentativa repetida apenas
        // sobrescreve o mesmo trecho, sem duplicar bytes no vídeo.
        await file.write(
          chunk.buffer,
          0,
          chunk.buffer.length,
          input.chunkIndex * metadata.chunkSize,
        );
      } finally {
        await file.close();
      }
      await writeFile(join(sessionRoot, `${input.chunkIndex}.received`), '');

      if (input.chunkIndex !== input.totalChunks - 1) {
        return {
          complete: false,
          chunkIndex: input.chunkIndex,
          totalChunks: input.totalChunks,
        };
      }

      for (let index = 0; index < input.totalChunks; index += 1) {
        if (!(await this.fileExists(join(sessionRoot, `${index}.received`)))) {
          throw new BadRequestException(
            `O bloco ${index + 1} precisa ser reenviado antes da conclusão.`,
          );
        }
      }

      // Renomear dentro do mesmo volume é uma operação imediata. Assim a
      // última requisição não fica copiando o vídeo inteiro e não estoura
      // o tempo limite do proxy do Railway.
      await rename(stagingPath, destination);
      await rm(sessionRoot, { recursive: true, force: true });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException({
        code: 'UPLOAD_ASSEMBLY_FAILED',
        message:
          'Não foi possível concluir o arquivo. Verifique o volume e o espaço disponível no servidor.',
        cause: error instanceof Error ? error.message : undefined,
      });
    }

    return this.completedUpload(input, chunk, filename);
  }

  private async getUploadMetadata(
    input: UploadChunkInput,
    receivedSize: number,
    metadataPath: string,
  ) {
    if (await this.fileExists(metadataPath)) {
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as {
        chunkSize: number;
        totalChunks: number;
        originalName: string;
      };
      if (
        metadata.totalChunks !== input.totalChunks ||
        metadata.originalName !== input.originalName
      ) {
        throw new BadRequestException('Os dados deste upload foram alterados.');
      }
      return metadata;
    }

    if (input.chunkIndex !== 0) {
      throw new BadRequestException('O primeiro bloco precisa ser reenviado.');
    }
    const metadata = {
      chunkSize: receivedSize,
      totalChunks: input.totalChunks,
      originalName: input.originalName,
    };
    await writeFile(metadataPath, JSON.stringify(metadata));
    return metadata;
  }

  private async fileExists(path: string) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async completedUpload(
    input: UploadChunkInput,
    chunk: Express.Multer.File,
    filename: string,
  ) {
    const contentType = input.mimeType || chunk.mimetype;
    await this.assets.persistLocalFile(filename, contentType);
    return this.completedResponse(filename, input.originalName, contentType);
  }

  private completedResponse(
    filename: string,
    originalName: string,
    mimeType: string,
  ) {
    return {
      complete: true,
      url: publicUploadUrl(filename),
      originalName,
      mimeType,
      materialType: this.materialTypeFor(mimeType, originalName),
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
