const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const port = Number(process.env.PORT || 4000);
const host = '127.0.0.1';

function isPortInUse() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function isThisApiHealthy() {
  return new Promise((resolve) => {
    const request = http.get(
      { host, port, path: '/api/health', timeout: 1500 },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => {
          try {
            resolve(
              response.statusCode === 200 && JSON.parse(body).status === 'ok',
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.once('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.once('error', () => resolve(false));
  });
}

async function main() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('A variavel PORT precisa conter uma porta valida.');
  }

  if (await isPortInUse()) {
    if (await isThisApiHealthy()) {
      console.log(
        `O backend ja esta ativo em http://localhost:${port}/api. Nao foi iniciada uma segunda instancia.`,
      );
      return;
    }

    throw new Error(
      `A porta ${port} esta sendo usada por outro programa. Feche esse programa ou altere PORT no .env.`,
    );
  }

  const prismaCli = path.join(
    __dirname,
    '..',
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );
  const generateResult = spawnSync(process.execPath, [prismaCli, 'generate'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });

  if (generateResult.status !== 0) {
    throw new Error(
      'Nao foi possivel atualizar o Prisma Client antes de iniciar o backend.',
    );
  }

  const nestCli = path.join(
    __dirname,
    '..',
    'node_modules',
    '@nestjs',
    'cli',
    'bin',
    'nest.js',
  );
  const child = spawn(process.execPath, [nestCli, 'start', '--watch'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });

  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
