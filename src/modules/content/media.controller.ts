import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AssetStorageService } from './asset-storage.service';

@Controller('media')
export class MediaController {
  constructor(private readonly assets: AssetStorageService) {}

  @Get(':filename')
  async stream(
    @Param('filename') filename: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ) {
    const asset = await this.assets.open(filename, range);
    response.status(asset.statusCode);
    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('Content-Length', String(asset.contentLength));
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (asset.contentRange) {
      response.setHeader('Content-Range', asset.contentRange);
    }
    asset.body.on('error', () => {
      if (!response.headersSent) response.status(500).end();
      else response.destroy();
    });
    asset.body.pipe(response);
  }
}
