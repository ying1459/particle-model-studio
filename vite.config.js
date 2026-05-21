import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { defineConfig } from 'vite';

const rootDir = process.cwd();

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'particle-studio-export-api',
      configureServer(server) {
        server.middlewares.use('/api/export-mov', async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'Method not allowed' });
            return;
          }

          let configPath = '';
          let modelPath = '';
          let morphTargetPath = '';
          let worldPath = '';
          let imageSplatPath = '';

          try {
            const body = await readJsonBody(req);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const outputName = sanitizeFilename(body.name || `particle-camera-${timestamp}`) + '.mov';
            const outputRelativePath = path.join('exports', outputName);
            const outputPath = path.resolve(rootDir, outputRelativePath);
            const tempDir = path.join(tmpdir(), 'particle-studio-export');
            configPath = path.join(tempDir, `config-${Date.now()}.json`);
            const modelUrl = await writeExportModel(body.model, Date.now());
            if (modelUrl) {
              modelPath = path.resolve(rootDir, modelUrl.replace(/^\//, ''));
            }
            const morphTargetUrl = await writeExportModel(body.morphTarget, Date.now() + 1);
            if (morphTargetUrl) {
              morphTargetPath = path.resolve(rootDir, morphTargetUrl.replace(/^\//, ''));
            }
            const worldUrl = await writeExportWorld(body.world, Date.now());
            if (worldUrl) {
              worldPath = path.resolve(rootDir, worldUrl.replace(/^\//, ''));
            }
            const imageSplatUrl = await writeExportImageSplat(body.imageSplat, Date.now());
            if (imageSplatUrl) {
              imageSplatPath = path.resolve(rootDir, imageSplatUrl.replace(/^\//, ''));
            }

            await mkdir(path.dirname(outputPath), { recursive: true });
            await mkdir(tempDir, { recursive: true });
            await writeFile(
              configPath,
              JSON.stringify(
                {
                  duration: clampNumber(body.duration, 0.25, 120, 5),
                  fps: clampNumber(body.fps, 1, 60, 30),
                  width: clampNumber(body.width, 128, 7680, 1920),
                  height: clampNumber(body.height, 128, 4320, 1080),
                  pixelRatio: clampNumber(body.pixelRatio, 0.5, 2, 1),
                  startTime: clampNumber(body.startTime, 0, 120, 0),
                  cameraStartTime: clampNumber(body.cameraStartTime, 0, 120, clampNumber(body.startTime, 0, 120, 0)),
                  effectStartTime: clampNumber(body.effectStartTime, 0, 86400, clampNumber(body.startTime, 0, 120, 0)),
                  out: outputRelativePath,
                  modelUrl,
                  morphTargetUrl,
                  worldUrl,
                  options: body.options || null,
                  cameraCurve: body.cameraCurve || null,
                  cameraKeyframes: Array.isArray(body.cameraKeyframes) ? body.cameraKeyframes : [],
                  cameraSnapshot: body.cameraSnapshot || null,
                  lights: Array.isArray(body.lights) ? body.lights : [],
                  imageSplat: body.imageSplat
                    ? {
                        ...body.imageSplat,
                        dataUrl: undefined,
                        url: imageSplatUrl
                      }
                    : null,
                  morphTarget: body.morphTarget
                    ? {
                        ...body.morphTarget,
                        dataUrl: undefined,
                        url: morphTargetUrl
                      }
                    : null,
                  world: body.world
                    ? {
                        ...body.world,
                        dataUrl: undefined,
                        url: worldUrl
                      }
                    : null
                },
                null,
                2
              )
            );

            const result = await runNodeScript(['scripts/export-mov.js', '--config', configPath]);
            sendJson(res, 200, {
              ok: true,
              path: outputPath,
              relativePath: outputRelativePath,
              log: result.stdout.slice(-3000)
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              error: error.message || String(error)
            });
          } finally {
            if (configPath) {
              await rm(configPath, { force: true });
            }
            if (modelPath) {
              await rm(modelPath, { force: true });
            }
            if (morphTargetPath) {
              await rm(morphTargetPath, { force: true });
            }
            if (worldPath) {
              await rm(worldPath, { force: true });
            }
            if (imageSplatPath) {
              await rm(imageSplatPath, { force: true });
            }
          }
        });
      }
    }
  ]
});

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 350_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function writeExportModel(model, stamp) {
  if ((!model?.dataUrl && !model?.path) || !model?.extension) {
    return '';
  }

  const extension = sanitizeExtension(model.extension);
  const relativePath = path.join('exports', `__export-model-${stamp}.${extension}`);
  const absolutePath = path.resolve(rootDir, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  if (model.path) {
    await copyFile(String(model.path), absolutePath);
  } else {
    const base64 = String(model.dataUrl).replace(/^data:[^;]+;base64,/, '');
    await writeFile(absolutePath, Buffer.from(base64, 'base64'));
  }
  return `/${relativePath.replace(/\\/g, '/')}`;
}

async function writeExportWorld(world, stamp) {
  if (!world?.dataUrl || !world?.extension) {
    return '';
  }

  const extension = sanitizeWorldExtension(world.extension);
  const relativePath = path.join('exports', `__export-world-${stamp}.${extension}`);
  const absolutePath = path.resolve(rootDir, relativePath);
  const base64 = String(world.dataUrl).replace(/^data:[^;]+;base64,/, '');

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(base64, 'base64'));
  return `/${relativePath.replace(/\\/g, '/')}`;
}

async function writeExportImageSplat(imageSplat, stamp) {
  if (!imageSplat?.dataUrl || !imageSplat?.extension) {
    return '';
  }

  const extension = sanitizeImageExtension(imageSplat.extension);
  const relativePath = path.join('exports', `__export-image-splat-${stamp}.${extension}`);
  const absolutePath = path.resolve(rootDir, relativePath);
  const base64 = String(imageSplat.dataUrl).replace(/^data:[^;]+;base64,/, '');

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(base64, 'base64'));
  return `/${relativePath.replace(/\\/g, '/')}`;
}


function sanitizeExtension(value) {
  const extension = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['glb', 'gltf', 'obj', 'stl', 'fbx'].includes(extension) ? extension : 'glb';
}

function sanitizeWorldExtension(value) {
  const extension = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['hdr', 'exr'].includes(extension) ? extension : 'hdr';
}

function sanitizeImageExtension(value) {
  const extension = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['jpg', 'jpeg', 'png', 'webp', 'hdr', 'exr', 'ply', 'splat', 'ksplat', 'spz'].includes(extension) ? extension : 'png';
}

async function runNodeScript(args) {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(stderr || stdout || `Export exited with code ${code}`);
  }

  return { stdout, stderr };
}

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function sanitizeFilename(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'particle-camera';
}
