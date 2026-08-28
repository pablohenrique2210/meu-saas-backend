import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetStorageService } from './asset-storage.service';

describe('AssetStorageService', () => {
  const previousUploadsDir = process.env.UPLOADS_DIR;
  const previousS3Bucket = process.env.S3_BUCKET;
  const previousBucket = process.env.BUCKET;
  let uploadsDir: string;
  let service: AssetStorageService;

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'asset-storage-'));
    process.env.UPLOADS_DIR = uploadsDir;
    delete process.env.S3_BUCKET;
    delete process.env.BUCKET;
    service = new AssetStorageService();
  });

  afterEach(async () => {
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    if (previousS3Bucket === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = previousS3Bucket;
    if (previousBucket === undefined) delete process.env.BUCKET;
    else process.env.BUCKET = previousBucket;
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('grava e entrega somente o intervalo solicitado pelo player', async () => {
    await service.storeBuffer(
      'video-teste.mp4',
      Buffer.from('0123456789'),
      'video/mp4',
    );

    const asset = await service.open('video-teste.mp4', 'bytes=2-5');
    const chunks: Buffer[] = [];
    for await (const chunk of asset.body) chunks.push(Buffer.from(chunk));

    expect(asset.statusCode).toBe(206);
    expect(asset.contentRange).toBe('bytes 2-5/10');
    expect(asset.contentLength).toBe(4);
    expect(Buffer.concat(chunks).toString()).toBe('2345');
  });

  it('explica quando um vídeo grande não possui bucket configurado', async () => {
    await expect(
      service.createDirectUpload('aula.mp4', 'video/mp4', 20 * 1024 * 1024),
    ).rejects.toMatchObject({
      response: {
        code: 'OBJECT_STORAGE_NOT_CONFIGURED',
      },
    });
  });
});
