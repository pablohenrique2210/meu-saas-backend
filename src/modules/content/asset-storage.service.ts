import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { access, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { basename, extname, join } from 'node:path';
import { ensureUploadsRootPath, uploadsRootPath } from '../../config/storage';

export interface StoredAsset {
  body: Readable;
  contentLength: number;
  contentType: string;
  contentRange?: string;
  statusCode: 200 | 206;
}

@Injectable()
export class AssetStorageService {
  async storeBuffer(filename: string, buffer: Buffer, contentType: string) {
    if (this.s3Config()) {
      await this.putS3Object(filename, buffer, contentType, buffer.length);
      return;
    }
    await writeFile(join(ensureUploadsRootPath(), filename), buffer);
  }

  async persistLocalFile(filename: string, contentType: string) {
    const config = this.s3Config();
    if (!config) return;
    const path = join(uploadsRootPath(), filename);
    const file = await stat(path);
    await this.putS3Object(
      filename,
      createReadStream(path),
      contentType,
      file.size,
    );
  }

  async open(filename: string, rangeHeader?: string): Promise<StoredAsset> {
    this.assertFilename(filename);
    const config = this.s3Config();
    if (config) {
      try {
        const response = await config.client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: this.objectKey(filename),
            ...(rangeHeader ? { Range: rangeHeader } : {}),
          }),
        );
        if (!response.Body || typeof response.ContentLength !== 'number') {
          throw new NotFoundException('Arquivo não encontrado.');
        }
        return {
          body: response.Body as Readable,
          contentLength: response.ContentLength,
          contentType: response.ContentType || this.contentTypeFor(filename),
          contentRange: response.ContentRange,
          statusCode: response.ContentRange ? 206 : 200,
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        const status = (error as { $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        if (status === 404 || status === 416) {
          throw new NotFoundException('Arquivo não encontrado.');
        }
        throw error;
      }
    }

    const path = join(uploadsRootPath(), filename);
    try {
      await access(path);
      const file = await stat(path);
      const range = this.parseRange(rangeHeader, file.size);
      return {
        body: createReadStream(path, range ?? undefined),
        contentLength: range ? range.end - range.start + 1 : file.size,
        contentType: this.contentTypeFor(filename),
        contentRange: range
          ? `bytes ${range.start}-${range.end}/${file.size}`
          : undefined,
        statusCode: range ? 206 : 200,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new NotFoundException(
        'Arquivo não encontrado no armazenamento permanente.',
      );
    }
  }

  async exists(filename: string) {
    this.assertFilename(filename);
    const config = this.s3Config();
    if (config) {
      try {
        await config.client.send(
          new HeadObjectCommand({
            Bucket: config.bucket,
            Key: this.objectKey(filename),
          }),
        );
        return true;
      } catch {
        return false;
      }
    }
    try {
      await access(join(uploadsRootPath(), filename));
      return true;
    } catch {
      return false;
    }
  }

  contentTypeFor(filename: string, suppliedType?: string) {
    if (suppliedType && suppliedType !== 'application/octet-stream') {
      return suppliedType;
    }
    const extension = extname(filename).toLowerCase();
    return (
      {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.doc': 'application/msword',
        '.docx':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }[extension] || 'application/octet-stream'
    );
  }

  private async putS3Object(
    filename: string,
    body: Buffer | Readable,
    contentType: string,
    contentLength: number,
  ) {
    const config = this.s3Config();
    if (!config) return;
    await config.client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: this.objectKey(filename),
        Body: body,
        ContentType: this.contentTypeFor(filename, contentType),
        ContentLength: contentLength,
      }),
    );
  }

  private s3Config() {
    const bucket = (process.env.S3_BUCKET || process.env.BUCKET)?.trim();
    const region = (process.env.S3_REGION || process.env.REGION)?.trim();
    const accessKeyId = (
      process.env.S3_ACCESS_KEY_ID || process.env.ACCESS_KEY_ID
    )?.trim();
    const secretAccessKey = (
      process.env.S3_SECRET_ACCESS_KEY || process.env.SECRET_ACCESS_KEY
    )?.trim();
    const endpoint = (process.env.S3_ENDPOINT || process.env.ENDPOINT)?.trim();
    if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;

    return {
      bucket,
      client: new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      }),
    };
  }

  private objectKey(filename: string) {
    const prefix = (process.env.S3_PREFIX || 'course-assets')
      .trim()
      .replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${filename}` : filename;
  }

  private assertFilename(filename: string) {
    if (
      !filename ||
      basename(filename) !== filename ||
      !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9]{1,12})?$/.test(filename)
    ) {
      throw new BadRequestException('Nome de arquivo inválido.');
    }
  }

  private parseRange(header: string | undefined, size: number) {
    if (!header) return null;
    const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
    if (!match) throw new BadRequestException('Intervalo de mídia inválido.');
    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    const end = Math.min(requestedEnd, size - 1);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end
    ) {
      throw new BadRequestException('Intervalo de mídia inválido.');
    }
    return { start, end };
  }
}
