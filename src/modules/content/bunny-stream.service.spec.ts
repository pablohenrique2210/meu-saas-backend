import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BunnyStreamService,
  parseBunnyReference,
} from './bunny-stream.service';

const id = '9db38922-a762-42df-8e3e-a41390fd53fe';
const reference = `bunny://123/${id}`;
describe('BunnyStreamService', () => {
  const service = new BunnyStreamService();
  const originalEnv = process.env;
  let upstream: jest.SpyInstance;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BUNNY_LIBRARY_ID: '123',
      BUNNY_READ_ONLY_API_KEY: 'read-key',
      BUNNY_EMBED_TOKEN_KEY: 'embed-key',
    };
    upstream = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({
          guid: id,
          videoLibraryId: 123,
          status: 3,
          length: 601,
        }),
      );
  });
  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('normalizes IDs but never accepts arbitrary hosts or paths', () => {
    expect(parseBunnyReference(reference)).toEqual({
      libraryId: '123',
      videoId: id,
    });
    expect(
      parseBunnyReference(
        `https://player.mediadelivery.net/embed/123/${id}?token=old`,
      ),
    ).toEqual({ libraryId: '123', videoId: id });
    for (const url of [
      'bunny://123/../../x',
      `https://iframe.mediadelivery.net.evil.test/embed/123/${id}`,
      '<iframe src="x">',
      `https://example.com/${id}`,
    ])
      expect(parseBunnyReference(url)).toBeNull();
  });
  it('verifies library before making a request', async () => {
    await expect(service.metadata(`bunny://999/${id}`)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(upstream).not.toHaveBeenCalled();
  });
  it('fetches fixed Bunny API with read-only credentials and signs only an expiring embed', async () => {
    const result = await service.playback(reference);
    expect(upstream).toHaveBeenCalledWith(
      `https://video.bunnycdn.com/library/123/videos/${id}`,
      expect.objectContaining({
        headers: { AccessKey: 'read-key' },
        redirect: 'error',
      }),
    );
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('not ready');
    const url = new URL(result.url);
    expect(url.searchParams.get('token')).toBe(
      createHash('sha256')
        .update(`embed-key${id}${result.expires}`)
        .digest('hex'),
    );
    expect(result.expires).toBeGreaterThan(Date.now() / 1000 + 7100);
    expect(JSON.stringify(result)).not.toMatch(/embed-key|read-key/);
  });
  it('returns processing without a playable URL', async () => {
    upstream.mockResolvedValue(
      Response.json({
        guid: id,
        videoLibraryId: 123,
        status: 2,
        length: 601,
        availableResolutions: '',
      }),
    );
    expect(await service.playback(reference)).toEqual({
      provider: 'bunny',
      status: 'processing',
    });
  });
  it('allows a ready resolution before all resolutions finish', async () => {
    upstream.mockResolvedValue(
      Response.json({
        guid: id,
        videoLibraryId: 123,
        status: 2,
        length: 601,
        availableResolutions: '360p',
      }),
    );
    expect((await service.playback(reference)).status).toBe('ready');
  });
  it('fails closed without signing configuration', async () => {
    delete process.env.BUNNY_EMBED_TOKEN_KEY;
    await expect(service.playback(reference)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('distinguishes missing video, failed encoding and upstream failure', async () => {
    upstream.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(service.metadata(reference)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    upstream.mockResolvedValue(
      Response.json({ guid: id, videoLibraryId: 123, status: 5, length: 601 }),
    );
    await expect(service.metadata(reference)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    upstream.mockRejectedValue(new Error('read-key'));
    await expect(service.metadata(reference)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('rejects mismatching metadata', async () => {
    upstream.mockResolvedValue(
      Response.json({ guid: id, videoLibraryId: 456, status: 3, length: 601 }),
    );
    await expect(service.metadata(reference)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
