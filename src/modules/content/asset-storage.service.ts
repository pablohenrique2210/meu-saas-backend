import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { access, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
  async createDirectUpload(
    originalName: string,
    mimeType: string,
    size: number,
  ) {
    const config = this.requireS3Config();
    const safeExtension = extname(originalName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '')
      .slice(0, 12);
    const filename = `${randomUUID()}${safeExtension}`;
    const key = this.objectKey(filename);
    const created = await config.client.send(
      new CreateMultipartUploadCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: this.contentTypeFor(originalName, mimeType),
      }),
    );
    if (!created.UploadId) {
      throw new BadRequestException('O bucket não iniciou o upload.');
    }

    const partSize = 8 * 1024 * 1024;
    const totalParts = Math.max(1, Math.ceil(size / partSize));
    if (totalParts > 10_000) {
      throw new BadRequestException('O arquivo excede o limite do bucket.');
    }
    const parts = await Promise.all(
      Array.from({ length: totalParts }, async (_, index) => {
        const partNumber = index + 1;
        const signedUrl = await getSignedUrl(
          config.client as unknown as Parameters<typeof getSignedUrl>[0],
          new UploadPartCommand({
            Bucket: config.bucket,
            Key: key,
            UploadId: created.UploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: 2 * 60 * 60 },
        );
        return { partNumber, signedUrl };
      }),
    );

    return {
      strategy: 'DIRECT_MULTIPART' as const,
      uploadId: created.UploadId,
      filename,
      partSize,
      parts,
    };
  }

  async completeDirectUpload(filename: string, uploadId: string) {
    this.assertFilename(filename);
    const config = this.requireS3Config();
    const uploadedParts: Array<{ ETag?: string; PartNumber?: number }> = [];
    let marker: string | undefined;
    do {
      const listed = await config.client.send(
        new ListPartsCommand({
          Bucket: config.bucket,
          Key: this.objectKey(filename),
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      uploadedParts.push(...(listed.Parts ?? []));
      marker = listed.IsTruncated
        ? String(listed.NextPartNumberMarker)
        : undefined;
    } while (marker);
    if (
      uploadedParts.length === 0 ||
      uploadedParts.some((part) => !part.ETag || !part.PartNumber)
    ) {
      throw new BadRequestException('O bucket não recebeu todas as partes.');
    }
    await config.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: config.bucket,
        Key: this.objectKey(filename),
        UploadId: uploadId,
        MultipartUpload: {
          Parts: uploadedParts.sort(
            (first, second) =>
              Number(first.PartNumber) - Number(second.PartNumber),
          ),
        },
      }),
    );
  }

  async abortDirectUpload(filename: string, uploadId: string) {
    this.assertFilename(filename);
    const config = this.requireS3Config();
    await config.client.send(
      new AbortMultipartUploadCommand({
        Bucket: config.bucket,
        Key: this.objectKey(filename),
        UploadId: uploadId,
      }),
    );
  }

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
    const bucket = (
      process.env.S3_BUCKET ||
      process.env.BUCKET ||
      process.env.AWS_S3_BUCKET_NAME
    )?.trim();
    const region = (
      process.env.S3_REGION ||
      process.env.REGION ||
      process.env.AWS_DEFAULT_REGION
    )?.trim();
    const accessKeyId = (
      process.env.S3_ACCESS_KEY_ID ||
      process.env.ACCESS_KEY_ID ||
      process.env.AWS_ACCESS_KEY_ID
    )?.trim();
    const secretAccessKey = (
      process.env.S3_SECRET_ACCESS_KEY ||
      process.env.SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY
    )?.trim();
    const endpoint = (
      process.env.S3_ENDPOINT ||
      process.env.ENDPOINT ||
      process.env.AWS_ENDPOINT_URL
    )?.trim();
    if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
    const urlStyle = (process.env.S3_URL_STYLE || process.env.AWS_S3_URL_STYLE)
      ?.trim()
      .toLowerCase();
    const forcePathStyle =
      process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === 'true' ||
      urlStyle === 'path';

    return {
      bucket,
      client: new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle } : {}),
      }),
    };
  }

  private requireS3Config() {
    const config = this.s3Config();
    if (!config) {
      throw new BadRequestException({
        code: 'OBJECT_STORAGE_NOT_CONFIGURED',
        message: 'Conecte um Railway Bucket ao backend antes de enviar vídeos.',
      });
    }
    return config;
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
