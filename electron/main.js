import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegStaticPath from 'ffmpeg-static';
import { injectSphericalMetadata } from './spatial-metadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const distDir = path.join(appRoot, 'dist');
const preloadPath = path.join(__dirname, 'preload.cjs');
let exportModelDir = '';
const runtimeAssetDirs = new Set();
const runtimeAssetMap = new Map();
const videoProxyCache = new Map();
const projectPaths = new Map();
const LARGE_PROJECT_STREAM_THRESHOLD_BYTES = 480 * 1024 * 1024;
const PROJECT_DATA_URL_PATTERN = Buffer.from('"dataUrl":"data:', 'utf8');
const MIN_SHARP_CHECKPOINT_BYTES = 1024 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'particle',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'camera');
  });
  registerAppProtocol();
  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  for (const dir of runtimeAssetDirs) {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  runtimeAssetDirs.clear();
  runtimeAssetMap.clear();
  videoProxyCache.clear();
});

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 720,
    title: 'Particle Model Studio',
    backgroundColor: '#090a0c',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  window.loadURL('particle://app/index.html');
}

function registerAppProtocol() {
  protocol.handle('particle', async (request) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    let filePath;
    let rootDir;

    if (pathname.startsWith('/__export-model/')) {
      filePath = path.join(exportModelDir, path.basename(pathname));
      rootDir = exportModelDir;
    } else if (pathname.startsWith('/__runtime-asset/')) {
      const [, , token] = pathname.split('/');
      const runtimePath = runtimeAssetMap.get(token);
      filePath = runtimePath && path.basename(runtimePath) === path.basename(pathname)
        ? runtimePath
        : '';
      rootDir = filePath ? path.dirname(filePath) : '';
    } else {
      filePath = path.join(distDir, pathname);
      rootDir = distDir;
    }

    if (!filePath || !isInside(rootDir, filePath)) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!existsSync(filePath)) {
      return new Response('Not found', { status: 404 });
    }

    if (pathname.startsWith('/__runtime-asset/') || pathname.startsWith('/__export-model/')) {
      return createRangedFileResponse(request, filePath);
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createRangedFileResponse(request, filePath) {
  const stats = statSync(filePath);
  const size = stats.size;
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': projectAssetMime(extension),
    'Content-Length': String(size)
  };

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  const range = request.headers.get('range');
  if (!range) {
    return new Response(Readable.toWeb(createReadStream(filePath)), {
      status: 200,
      headers
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || size <= 0) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        'Content-Range': `bytes */${size}`
      }
    });
  }

  let start;
  let end;
  if (match[1] === '' && match[2] !== '') {
    const suffixLength = Math.max(0, Number.parseInt(match[2], 10) || 0);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Math.max(0, Number.parseInt(match[1], 10) || 0);
    end = match[2] === ''
      ? size - 1
      : Math.min(size - 1, Number.parseInt(match[2], 10) || size - 1);
  }

  if (start >= size || end < start) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        'Content-Range': `bytes */${size}`
      }
    });
  }

  const chunkSize = end - start + 1;
  return new Response(Readable.toWeb(createReadStream(filePath, { start, end })), {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(chunkSize),
      'Content-Range': `bytes ${start}-${end}/${size}`
    }
  });
}

function registerIpc() {
  ipcMain.handle('export-mov', async (_event, payload) => {
    return exportMov(payload || {});
  });

  ipcMain.handle('save-project', async (event, payload) => {
    try {
      return await saveProjectFile(event, payload || {});
    } catch (error) {
      const formatted = formatProjectSaveError(error);
      console.error('Project save failed.', error);
      return {
        ok: false,
        error: formatted,
        code: error?.code || 'PROJECT_SAVE_FAILED'
      };
    }
  });

  ipcMain.handle('save-project-recovery', async (event, payload) => {
    try {
      return await saveProjectRecoveryFile(event, payload || {});
    } catch (error) {
      console.error('Project recovery save failed.', error);
      return {
        ok: false,
        error: formatProjectSaveError(error),
        code: error?.code || 'PROJECT_RECOVERY_SAVE_FAILED'
      };
    }
  });

  ipcMain.handle('open-project', async (event) => {
    return openProjectFile(event);
  });

  ipcMain.handle('prepare-video-proxy', async (_event, payload) => {
    return prepareVideoProxy(payload || {});
  });

  ipcMain.handle('convert-blend-to-glb', async (_event, payload) => {
    return convertBlendToGlb(payload || {});
  });

  ipcMain.handle('check-local-sharp', async () => {
    return checkLocalSharp();
  });

  ipcMain.handle('install-local-sharp', async (_event, payload) => {
    return installLocalSharp(payload || {});
  });

  ipcMain.handle('run-local-sharp', async (_event, payload) => {
    return runLocalSharp(payload || {});
  });

  ipcMain.handle('show-item-in-folder', async (_event, filePath) => {
    if (filePath && existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });
}

async function saveProjectFile(event, payload) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const ownerId = event.sender.id;
  let outputPath = payload.saveAs ? '' : projectPaths.get(ownerId) || '';
  const suggestedName = sanitizeFilename(payload.suggestedName || 'untitled-project');

  if (!outputPath) {
    const result = await dialog.showSaveDialog(owner || undefined, {
      title: '保存 Particle Model Studio 工程',
      defaultPath: `${suggestedName}.pms`,
      filters: [
        { name: 'Particle Model Studio Project', extensions: ['pms'] },
        { name: 'JSON', extensions: ['json'] }
      ]
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    outputPath = result.filePath.toLowerCase().endsWith('.pms') ? result.filePath : `${result.filePath}.pms`;
  }

  const { document, streamedAssets } = await prepareProjectDocumentForSave(payload.document || {});
  const bytes = await writeProjectDocument(outputPath, document, streamedAssets);
  projectPaths.set(ownerId, outputPath);
  if (owner && !owner.isDestroyed()) {
    owner.setTitle(`${path.basename(outputPath)} - Particle Model Studio`);
  }
  return {
    ok: true,
    path: outputPath,
    name: path.basename(outputPath),
    bytes
  };
}

async function saveProjectRecoveryFile(_event, payload) {
  const recoveryDir = path.join(app.getPath('documents'), 'Particle Model Studio Recovery');
  await mkdir(recoveryDir, { recursive: true });
  const suggestedName = sanitizeFilename(payload.suggestedName || 'particle-project');
  const outputPath = path.join(recoveryDir, `${suggestedName}-recovery-${timestampName()}.pms`);
  const { document, streamedAssets } = await prepareProjectDocumentForSave(payload.document || {});
  const bytes = await writeProjectDocument(outputPath, document, streamedAssets);
  return {
    ok: true,
    path: outputPath,
    name: path.basename(outputPath),
    bytes
  };
}

async function openProjectFile(event) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(owner || undefined, {
    title: '打开 Particle Model Studio 工程',
    properties: ['openFile'],
    filters: [
      { name: 'Particle Model Studio Project', extensions: ['pms'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, canceled: true };
  }

  const inputPath = result.filePaths[0];
  const { document, largeProject } = await readProjectDocument(inputPath);
  validateProjectDocument(document);
  materializeProjectAssetPaths(document);
  projectPaths.set(event.sender.id, inputPath);
  if (owner && !owner.isDestroyed()) {
    owner.setTitle(`${path.basename(inputPath)} - Particle Model Studio`);
  }
  return {
    ok: true,
    path: inputPath,
    name: path.basename(inputPath),
    document,
    largeProject
  };
}

async function readProjectDocument(inputPath) {
  const size = statSync(inputPath).size;
  if (size > LARGE_PROJECT_STREAM_THRESHOLD_BYTES) {
    return streamLargeProjectDocument(inputPath);
  }

  try {
    return {
      document: JSON.parse((await readFile(inputPath, 'utf8')).replace(/^\uFEFF/, '')),
      largeProject: null
    };
  } catch (error) {
    if (isProjectStringTooLargeError(error)) {
      return streamLargeProjectDocument(inputPath);
    }
    throw error;
  }
}

function isProjectStringTooLargeError(error) {
  return error?.code === 'ERR_STRING_TOO_LONG' ||
    /Cannot create a string longer/i.test(String(error?.message || error));
}

async function streamLargeProjectDocument(inputPath) {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'particle-project-open-'));
  const slimPath = path.join(runtimeDir, 'project.slim.pms');
  const input = createReadStream(inputPath, { highWaterMark: 1024 * 1024 });
  const output = createWriteStream(slimPath);
  const extractedAssets = [];
  let buffer = Buffer.alloc(0);
  let state = 'scan';
  let recentText = '';
  let dataHeader = '';
  let activeAsset = null;

  const appendRecent = (chunk) => {
    if (!chunk?.length) {
      return;
    }
    recentText = `${recentText}${chunk.toString('utf8')}`.slice(-16384);
  };

  const writeRaw = async (chunk) => {
    if (!chunk?.length) {
      return;
    }
    await writeStreamChunk(output, chunk);
    appendRecent(chunk);
  };

  try {
    for await (const chunk of input) {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;

      while (buffer.length) {
        if (state === 'scan') {
          const index = buffer.indexOf(PROJECT_DATA_URL_PATTERN);
          if (index < 0) {
            const safeLength = Math.max(0, buffer.length - PROJECT_DATA_URL_PATTERN.length + 1);
            if (safeLength > 0) {
              await writeRaw(buffer.subarray(0, safeLength));
              buffer = buffer.subarray(safeLength);
            }
            break;
          }

          await writeRaw(buffer.subarray(0, index));
          buffer = buffer.subarray(index + PROJECT_DATA_URL_PATTERN.length);
          dataHeader = 'data:';
          state = 'header';
        }

        if (state === 'header') {
          const commaIndex = buffer.indexOf(0x2c);
          if (commaIndex < 0) {
            dataHeader += buffer.toString('ascii');
            buffer = Buffer.alloc(0);
            break;
          }

          dataHeader += buffer.subarray(0, commaIndex + 1).toString('ascii');
          buffer = buffer.subarray(commaIndex + 1);
          activeAsset = createLargeProjectAsset(runtimeDir, dataHeader, recentText, extractedAssets.length);
          extractedAssets.push(activeAsset.summary);
          await writeStreamChunk(output, Buffer.from(createLargeProjectAssetReplacement(activeAsset), 'utf8'));
          state = 'base64';
        }

        if (state === 'base64') {
          const quoteIndex = buffer.indexOf(0x22);
          if (quoteIndex < 0) {
            await writeBase64AssetChunk(activeAsset, buffer.toString('ascii'));
            buffer = Buffer.alloc(0);
            break;
          }

          await writeBase64AssetChunk(activeAsset, buffer.subarray(0, quoteIndex).toString('ascii'));
          await finishLargeProjectAsset(activeAsset);
          activeAsset = null;
          buffer = buffer.subarray(quoteIndex + 1);
          state = 'scan';
        }
      }
    }

    if (state !== 'scan') {
      throw new Error('超大工程中的内嵌素材数据不完整，无法完成流式打开。');
    }

    await writeRaw(buffer);
    output.end();
    await once(output, 'finish');
    const document = JSON.parse((await readFile(slimPath, 'utf8')).replace(/^\uFEFF/, ''));
    runtimeAssetDirs.add(runtimeDir);
    return {
      document,
      largeProject: {
        streamed: true,
        originalBytes: statSync(inputPath).size,
        slimBytes: statSync(slimPath).size,
        extractedAssets: extractedAssets.map((asset) => ({
          name: asset.name,
          extension: asset.extension,
          bytes: asset.bytes,
          path: asset.path
        }))
      }
    };
  } catch (error) {
    if (activeAsset?.stream) {
      activeAsset.stream.destroy();
    }
    output.destroy();
    await rm(runtimeDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function createLargeProjectAsset(runtimeDir, header, recentText, index) {
  if (!/;base64,$/i.test(header)) {
    throw new Error('超大工程包含非 base64 的 dataUrl，暂时无法流式拆包。');
  }

  const mime = /^data:([^;,]+)?/i.exec(header)?.[1] || 'application/octet-stream';
  const name = inferRecentProjectString(recentText, 'name') ||
    inferRecentProjectString(recentText, 'label') ||
    `asset-${index + 1}`;
  const extension = inferLargeProjectAssetExtension(recentText, mime, name);
  const safeName = sanitizeFilename(name);
  const filename = `${String(index + 1).padStart(3, '0')}-${safeName.toLowerCase().endsWith(`.${extension}`) ? safeName : `${safeName}.${extension}`}`;
  const filePath = path.join(runtimeDir, filename);
  const url = registerRuntimeAsset(filePath, filename);
  const stream = createWriteStream(filePath);
  const summary = {
    name,
    extension,
    mime,
    path: filePath,
    url,
    bytes: 0
  };
  return {
    stream,
    summary,
    base64Remainder: ''
  };
}

function createLargeProjectAssetReplacement(asset) {
  return [
    '"dataUrl":null',
    `"path":${JSON.stringify(asset.summary.path)}`,
    `"sourcePath":${JSON.stringify(asset.summary.path)}`,
    `"url":${JSON.stringify(asset.summary.url)}`
  ].join(',');
}

async function writeBase64AssetChunk(asset, chunk) {
  if (!asset || !chunk) {
    return;
  }
  const clean = chunk.replace(/\s+/g, '');
  if (!clean) {
    return;
  }
  const combined = `${asset.base64Remainder}${clean}`;
  const flushLength = combined.length - (combined.length % 4);
  if (flushLength > 0) {
    const bytes = Buffer.from(combined.slice(0, flushLength), 'base64');
    if (bytes.length) {
      asset.summary.bytes += bytes.length;
      await writeStreamChunk(asset.stream, bytes);
    }
  }
  asset.base64Remainder = combined.slice(flushLength);
}

async function finishLargeProjectAsset(asset) {
  if (!asset) {
    return;
  }
  if (asset.base64Remainder) {
    const bytes = Buffer.from(asset.base64Remainder, 'base64');
    if (bytes.length) {
      asset.summary.bytes += bytes.length;
      await writeStreamChunk(asset.stream, bytes);
    }
    asset.base64Remainder = '';
  }
  asset.stream.end();
  await once(asset.stream, 'finish');
}

function registerRuntimeAsset(filePath, filename = path.basename(filePath)) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  runtimeAssetMap.set(token, filePath);
  return `/__runtime-asset/${token}/${encodeURIComponent(filename)}`;
}

function inferRecentProjectString(text, key) {
  const matches = [...String(text).matchAll(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'g'))];
  const raw = matches.at(-1)?.[1];
  if (!raw) {
    return '';
  }
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

function inferLargeProjectAssetExtension(recentText, mime, name) {
  const explicit = inferRecentProjectString(recentText, 'extension');
  const fromName = String(name || '').split('.').pop();
  const fromMime = extensionFromMime(mime);
  return sanitizeProjectAssetExtension(explicit || fromName || fromMime || 'bin');
}

function extensionFromMime(mime) {
  const values = {
    'model/gltf-binary': 'glb',
    'model/gltf+json': 'gltf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/vnd.radiance': 'hdr',
    'image/x-exr': 'exr',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm'
  };
  return values[String(mime || '').toLowerCase()] || '';
}

function sanitizeProjectAssetExtension(value) {
  const extension = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return extension || 'bin';
}

function materializeProjectAssetPaths(document) {
  const scene = document?.scene || {};
  const materialize = (descriptor) => {
    if (!descriptor || typeof descriptor !== 'object') {
      return descriptor;
    }
    const sourcePath = descriptor.path || descriptor.sourcePath;
    if (!sourcePath || !existsSync(String(sourcePath))) {
      return descriptor;
    }
    const absolutePath = path.resolve(String(sourcePath));
    descriptor.path = absolutePath;
    if (!descriptor.dataUrl) {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      runtimeAssetMap.set(token, absolutePath);
      descriptor.url = `/__runtime-asset/${token}/${encodeURIComponent(path.basename(absolutePath))}`;
    }
    return descriptor;
  };

  scene.model = materialize(scene.model);
  scene.morphTarget = materialize(scene.morphTarget);
  scene.world = materialize(scene.world);
  scene.imageSplat = materialize(scene.imageSplat);
  if (Array.isArray(scene.videoPlanes?.items)) {
    scene.videoPlanes.items.forEach(materialize);
  }
  if (Array.isArray(scene.sceneModels?.models)) {
    scene.sceneModels.models.forEach(materialize);
  }
}

function validateProjectDocument(document) {
  if (!document || document.format !== 'particle-model-studio-project' || Number(document.schemaVersion) !== 1) {
    throw new Error('这不是有效的 Particle Model Studio .pms 工程文件。');
  }
  if (!document.scene || typeof document.scene !== 'object') {
    throw new Error('工程文件缺少场景数据。');
  }
}

async function prepareProjectDocumentForSave(document) {
  const sourceScene = document?.scene || {};
  const scene = { ...sourceScene };
  const embedded = { ...document, scene };
  const streamedAssets = [];
  if (scene.model) {
    scene.model = await prepareProjectAsset(scene.model, streamedAssets);
  }
  if (scene.morphTarget) {
    scene.morphTarget = await prepareProjectAsset(scene.morphTarget, streamedAssets);
  }
  if (scene.world) {
    scene.world = await prepareProjectAsset(scene.world, streamedAssets);
  }
  if (scene.imageSplat) {
    scene.imageSplat = await prepareProjectAsset(scene.imageSplat, streamedAssets);
  }
  if (Array.isArray(scene.videoPlanes?.items)) {
    const items = [];
    for (const video of scene.videoPlanes.items) {
      items.push(await prepareProjectAsset(video, streamedAssets));
    }
    scene.videoPlanes = { ...scene.videoPlanes, items };
  }
  if (Array.isArray(scene.sceneModels?.models)) {
    const models = [];
    for (const model of scene.sceneModels.models) {
      models.push(await prepareProjectAsset(model, streamedAssets));
    }
    scene.sceneModels = { ...scene.sceneModels, models };
  }
  return { document: embedded, streamedAssets };
}

async function prepareProjectAsset(descriptor, streamedAssets) {
  const embedded = { ...descriptor };
  const sourcePath = embedded.path ? path.resolve(String(embedded.path)) : '';
  if (sourcePath && existsSync(sourcePath)) {
    const extension = String(embedded.extension || path.extname(sourcePath).slice(1)).toLowerCase();
    const token = `__PMS_STREAMED_ASSET_${streamedAssets.length}_${Date.now()}__`;
    streamedAssets.push({ token, sourcePath, mime: projectAssetMime(extension) });
    embedded.dataUrl = token;
    embedded.size = embedded.size || statSync(sourcePath).size;
    embedded.sourcePath = sourcePath;
  }
  if (!embedded.dataUrl) {
    const missing = new Error(`无法读取素材“${embedded.name || sourcePath || '未命名素材'}”，请重新导入后再保存。`);
    missing.code = 'PROJECT_ASSET_MISSING';
    throw missing;
  }
  delete embedded.path;
  delete embedded.url;
  return embedded;
}

async function writeProjectDocument(outputPath, document, streamedAssets) {
  const serialized = JSON.stringify(document);
  const outputDir = path.dirname(outputPath);
  if (!existsSync(outputDir)) {
    const missingDir = new Error(`保存目录不存在：${outputDir}`);
    missingDir.code = 'ENOENT';
    throw missingDir;
  }
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  const output = createWriteStream(tempPath, { encoding: 'utf8' });
  const streamError = once(output, 'error').then(([error]) => {
    throw error;
  });
  let cursor = 0;

  try {
    for (const asset of streamedAssets) {
      const quotedToken = JSON.stringify(asset.token);
      const tokenIndex = serialized.indexOf(quotedToken, cursor);
      if (tokenIndex < 0) {
        const tokenError = new Error(`工程素材占位符丢失：${path.basename(asset.sourcePath)}`);
        tokenError.code = 'PROJECT_ASSET_TOKEN_MISSING';
        throw tokenError;
      }

      await writeStreamChunk(output, serialized.slice(cursor, tokenIndex));
      await writeStreamChunk(output, `"data:${asset.mime};base64,`);
      const input = createReadStream(asset.sourcePath, { encoding: 'base64' });
      for await (const chunk of input) {
        await writeStreamChunk(output, chunk);
      }
      await writeStreamChunk(output, '"');
      cursor = tokenIndex + quotedToken.length;
    }

    await writeStreamChunk(output, serialized.slice(cursor));
    output.end();
    await Promise.race([once(output, 'finish'), streamError]);
    await replaceProjectFile(tempPath, outputPath);
    return statSync(outputPath).size;
  } catch (error) {
    output.destroy();
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeStreamChunk(stream, chunk) {
  if (!chunk || stream.write(chunk)) {
    return;
  }
  await Promise.race([
    once(stream, 'drain'),
    once(stream, 'error').then(([error]) => {
      throw error;
    })
  ]);
}

async function replaceProjectFile(tempPath, outputPath) {
  try {
    await rename(tempPath, outputPath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) {
      throw error;
    }
    await copyFile(tempPath, outputPath);
    await rm(tempPath, { force: true });
  }
}

function formatProjectSaveError(error) {
  const code = error?.code || '';
  if (code === 'ENOSPC') {
    return '磁盘空间不足，请清理空间或选择其他磁盘。';
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return '没有写入权限，请保存到“文档”或其他可写目录。';
  }
  if (code === 'ENOENT') {
    return '保存目录或工程素材不存在，请重新选择位置或导入素材。';
  }
  if (code === 'PROJECT_ASSET_MISSING') {
    return error.message;
  }
  if (/heap|allocation|out of memory|invalid string length/i.test(error?.message || '')) {
    return '工程素材过大导致内存不足，请关闭其他程序后重试。';
  }
  return error?.message || '工程保存失败。';
}

function projectAssetMime(extension) {
  const values = {
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    hdr: 'image/vnd.radiance',
    exr: 'image/x-exr',
    json: 'application/json'
  };
  return values[extension] || 'application/octet-stream';
}

async function prepareVideoProxy(payload = {}) {
  const sourceExtension = sanitizeVideoExtension(
    payload.extension ||
    path.extname(String(payload.path || payload.name || '')).slice(1)
  );
  const sourcePath = payload.path ? path.resolve(String(payload.path)) : '';
  const cacheKey = sourcePath && existsSync(sourcePath) ? getVideoProxyCacheKey(sourcePath) : '';

  if (cacheKey) {
    const cached = videoProxyCache.get(cacheKey);
    if (cached) {
      const cachedResult = await Promise.resolve(cached.promise || cached).catch(() => null);
      if (cachedResult?.ok && isUsableRuntimeAsset(cachedResult.path)) {
        return {
          ...cachedResult,
          cached: true
        };
      }
      videoProxyCache.delete(cacheKey);
    }
  }

  const proxyPromise = buildVideoProxy({
    payload,
    sourceExtension,
    sourcePath
  });

  if (cacheKey) {
    videoProxyCache.set(cacheKey, { promise: proxyPromise });
  }

  const result = await proxyPromise;
  if (cacheKey) {
    if (result?.ok && isUsableRuntimeAsset(result.path)) {
      videoProxyCache.set(cacheKey, result);
    } else {
      videoProxyCache.delete(cacheKey);
    }
  }
  return result;
}

async function buildVideoProxy({ payload = {}, sourceExtension = 'mov', sourcePath = '' } = {}) {
  let runtimeDir = '';
  let inputPath = '';

  try {
    runtimeDir = await mkdtemp(path.join(tmpdir(), 'particle-video-runtime-'));
    if (sourcePath && existsSync(sourcePath)) {
      inputPath = sourcePath;
    } else if (payload.dataUrl) {
      const parsed = parseDataUrl(String(payload.dataUrl));
      const inputName = `source.${sourceExtension || 'mov'}`;
      inputPath = path.join(runtimeDir, inputName);
      await writeFile(inputPath, parsed.buffer);
    }

    if (!inputPath || !existsSync(inputPath)) {
      throw new Error('视频文件路径无效，无法生成 MOV 代理。');
    }

    const basename = sanitizeFilename(
      path.basename(String(payload.name || inputPath), path.extname(String(payload.name || inputPath))) ||
      'video'
    );
    const outputName = `${basename}-proxy.webm`;
    const outputPath = path.join(runtimeDir, outputName);
    const log = await transcodeVideoToWebm(inputPath, outputPath);

    if (!existsSync(outputPath) || statSync(outputPath).size <= 0) {
      throw new Error('MOV 代理转码没有生成可读取的视频。');
    }

    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runtimeAssetDirs.add(runtimeDir);
    runtimeAssetMap.set(token, outputPath);

    return {
      ok: true,
      path: outputPath,
      url: `/__runtime-asset/${token}/${encodeURIComponent(outputName)}`,
      name: outputName,
      extension: 'webm',
      sourceExtension,
      size: statSync(outputPath).size,
      cached: false,
      log: log.slice(-5000)
    };
  } catch (error) {
    if (runtimeDir) {
      await rm(runtimeDir, { recursive: true, force: true }).catch(() => {});
    }
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

function getVideoProxyCacheKey(inputPath) {
  try {
    const absolutePath = path.resolve(String(inputPath));
    const stats = statSync(absolutePath);
    return `${absolutePath}|${stats.size}|${stats.mtimeMs}`;
  } catch {
    return '';
  }
}

function isUsableRuntimeAsset(filePath) {
  try {
    return Boolean(filePath && existsSync(filePath) && statSync(filePath).size > 0);
  } catch {
    return false;
  }
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('视频 dataUrl 无效。');
  }
  const isBase64 = Boolean(match[2]);
  const body = match[3] || '';
  return {
    mime: match[1] || 'application/octet-stream',
    buffer: isBase64
      ? Buffer.from(body, 'base64')
      : Buffer.from(decodeURIComponent(body), 'utf8')
  };
}

async function transcodeVideoToWebm(inputPath, outputPath) {
  return runProcess(
    getFfmpegPath(),
    [
      '-y',
      '-hide_banner',
      '-i', inputPath,
      '-map', '0:v:0',
      '-an',
      '-vf', 'format=rgba',
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-auto-alt-ref', '0',
      '-deadline', 'realtime',
      '-cpu-used', '8',
      '-row-mt', '1',
      '-threads', '0',
      '-tile-columns', '2',
      '-frame-parallel', '1',
      '-lag-in-frames', '0',
      '-b:v', '0',
      '-crf', '32',
      outputPath
    ],
    {
      cwd: path.dirname(inputPath),
      timeoutMs: 20 * 60 * 1000
    }
  );
}

async function exportMov(payload) {
  const format = normalizeExportFormat(payload.format);
  const duration = clampNumber(payload.duration, 0.25, 120, 5);
  const fps = clampNumber(payload.fps, 1, 60, 30);
  let width = Math.round(clampNumber(payload.width, 128, 7680, 1920));
  let height = Math.round(clampNumber(payload.height, 128, 4320, 1080));
  if (format !== 'mov') {
    width -= width % 2;
    height -= height % 2;
  }
  if (format === 'mp4-360') {
    height = Math.max(128, Math.round(width / 2));
  }
  const pixelRatio = clampNumber(payload.pixelRatio, 0.5, 2, 1);
  const startTime = clampNumber(payload.startTime, 0, 120, 0);
  const cameraStartTime = clampNumber(payload.cameraStartTime, 0, 120, startTime);
  const effectStartTime = clampNumber(payload.effectStartTime, 0, 86400, startTime);
  const frameCount = Math.max(2, Math.round(duration * fps));
  const outputDir = path.join(app.getPath('videos'), 'Particle Model Studio');
  const extension = format === 'mov' ? 'mov' : 'mp4';
  const outputName = `${sanitizeFilename(payload.name || `particle-camera-${timestampName()}`)}.${extension}`;
  const outputPath = path.join(outputDir, outputName);
  const framesDir = await mkdtemp(path.join(tmpdir(), 'particle-desktop-mov-'));
  exportModelDir = await mkdtemp(path.join(tmpdir(), 'particle-desktop-model-'));
  let modelUrl = '';
  let morphTargetUrl = '';
  let worldUrl = '';
  let imageSplatUrl = '';
  let sceneModelsForRenderer = null;
  let videoPlanesForRenderer = null;
  let hiddenWindow;

  try {
    await mkdir(outputDir, { recursive: true });

    if (payload.model?.path && payload.model?.extension) {
      const extension = sanitizeExtension(payload.model.extension);
      const modelName = `current-model.${extension}`;
      const modelPath = path.join(exportModelDir, modelName);
      await copyFile(String(payload.model.path), modelPath);
      modelUrl = `/__export-model/${modelName}`;
    } else if (payload.model?.dataUrl && payload.model?.extension) {
      const extension = sanitizeExtension(payload.model.extension);
      const modelName = `current-model.${extension}`;
      const modelPath = path.join(exportModelDir, modelName);
      const base64 = String(payload.model.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await writeFile(modelPath, Buffer.from(base64, 'base64'));
      modelUrl = `/__export-model/${modelName}`;
    } else if ((payload.options?.effectMode || 'particles') !== 'image' && !payload.sceneModels?.models?.length && !payload.videoPlanes?.items?.length) {
      throw new Error('当前模型没有可用于导出的文件数据，请重新导入模型后再导出。');
    }

    if (Array.isArray(payload.sceneModels?.models) && payload.sceneModels.models.length) {
      sceneModelsForRenderer = {
        activeId: payload.sceneModels.activeId,
        models: []
      };

      for (let index = 0; index < payload.sceneModels.models.length; index += 1) {
        const sceneModel = payload.sceneModels.models[index];
        if (!sceneModel?.extension) {
          continue;
        }
        const extension = sanitizeExtension(sceneModel.extension);
        const modelName = `scene-model-${index}.${extension}`;
        const modelPath = path.join(exportModelDir, modelName);
        if (sceneModel.path) {
          await copyFile(String(sceneModel.path), modelPath);
        } else if (sceneModel.dataUrl) {
          const base64 = String(sceneModel.dataUrl).replace(/^data:[^;]+;base64,/, '');
          await writeFile(modelPath, Buffer.from(base64, 'base64'));
        } else {
          continue;
        }

        const url = `/__export-model/${modelName}`;
        sceneModelsForRenderer.models.push({
          ...sceneModel,
          path: undefined,
          dataUrl: undefined,
          url
        });
        if (!modelUrl) {
          modelUrl = url;
        }
      }
    }

    if (payload.morphTarget?.path && payload.morphTarget?.extension) {
      const extension = sanitizeExtension(payload.morphTarget.extension);
      const targetName = `morph-target.${extension}`;
      const targetPath = path.join(exportModelDir, targetName);
      await copyFile(String(payload.morphTarget.path), targetPath);
      morphTargetUrl = `/__export-model/${targetName}`;
    } else if (payload.morphTarget?.dataUrl && payload.morphTarget?.extension) {
      const extension = sanitizeExtension(payload.morphTarget.extension);
      const targetName = `morph-target.${extension}`;
      const targetPath = path.join(exportModelDir, targetName);
      const base64 = String(payload.morphTarget.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await writeFile(targetPath, Buffer.from(base64, 'base64'));
      morphTargetUrl = `/__export-model/${targetName}`;
    }

    if (payload.world?.dataUrl && payload.world?.extension) {
      const extension = sanitizeWorldExtension(payload.world.extension);
      const worldName = `current-world.${extension}`;
      const worldPath = path.join(exportModelDir, worldName);
      const base64 = String(payload.world.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await writeFile(worldPath, Buffer.from(base64, 'base64'));
      worldUrl = `/__export-model/${worldName}`;
    }

    if (payload.imageSplat?.path && payload.imageSplat?.extension) {
      const extension = sanitizeImageExtension(payload.imageSplat.extension);
      const imageSplatName = `current-image-splat.${extension}`;
      const imageSplatPath = path.join(exportModelDir, imageSplatName);
      await copyFile(String(payload.imageSplat.path), imageSplatPath);
      imageSplatUrl = `/__export-model/${imageSplatName}`;
    } else if (payload.imageSplat?.dataUrl && payload.imageSplat?.extension) {
      const extension = sanitizeImageExtension(payload.imageSplat.extension);
      const imageSplatName = `current-image-splat.${extension}`;
      const imageSplatPath = path.join(exportModelDir, imageSplatName);
      const base64 = String(payload.imageSplat.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await writeFile(imageSplatPath, Buffer.from(base64, 'base64'));
      imageSplatUrl = `/__export-model/${imageSplatName}`;
    }

    if (Array.isArray(payload.videoPlanes?.items) && payload.videoPlanes.items.length) {
      videoPlanesForRenderer = {
        activeId: payload.videoPlanes.activeId,
        items: []
      };

      for (let index = 0; index < payload.videoPlanes.items.length; index += 1) {
        const videoPlane = payload.videoPlanes.items[index];
        if (!videoPlane?.extension) {
          continue;
        }
        const extension = sanitizeVideoExtension(videoPlane.extension);
        const originalVideoName = `video-plane-${index}.${extension}`;
        const originalVideoPath = path.join(exportModelDir, originalVideoName);
        if (videoPlane.path) {
          await copyFile(String(videoPlane.path), originalVideoPath);
        } else if (videoPlane.dataUrl) {
          const base64 = String(videoPlane.dataUrl).replace(/^data:[^;]+;base64,/, '');
          await writeFile(originalVideoPath, Buffer.from(base64, 'base64'));
        } else {
          continue;
        }

        let renderVideoName = originalVideoName;
        let renderVideoExtension = extension;
        let renderVideoPath = originalVideoPath;
        if (extension === 'mov') {
          renderVideoName = `video-plane-${index}-proxy.webm`;
          renderVideoExtension = 'webm';
          renderVideoPath = path.join(exportModelDir, renderVideoName);
          await transcodeVideoToWebm(originalVideoPath, renderVideoPath);
        }

        videoPlanesForRenderer.items.push({
          ...videoPlane,
          path: undefined,
          dataUrl: undefined,
          sourceExtension: extension,
          playbackExtension: renderVideoExtension,
          url: `/__export-model/${renderVideoName}`
        });
      }
    }

    hiddenWindow = new BrowserWindow({
      show: false,
      width,
      height,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: false
      }
    });

    const params = new URLSearchParams({
      export: '1',
      transparent: format === 'mov' ? '1' : '0',
      duration: String(duration),
      pixelRatio: String(pixelRatio),
      t: String(Date.now())
    });
    if (modelUrl) {
      params.set('model', modelUrl);
    }
    if (morphTargetUrl) {
      params.set('morphTarget', morphTargetUrl);
    }
    if (worldUrl) {
      params.set('world', worldUrl);
    }

    await hiddenWindow.loadURL(`particle://app/index.html?${params.toString()}`);
    await waitForRendererReady(hiddenWindow);
    await hiddenWindow.webContents.executeJavaScript(
      `window.particleStudio.setExportResolution(${JSON.stringify(width)}, ${JSON.stringify(height)}, ${JSON.stringify(fps)})`
    );

    if (payload.options) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setOptions(${JSON.stringify(payload.options)})`
      );
    }

    if (sceneModelsForRenderer?.models?.length) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setSceneModels(${JSON.stringify(sceneModelsForRenderer)})`
      );
    }

    if (Array.isArray(payload.lights)) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setLights(${JSON.stringify(payload.lights)})`
      );
    }

    if (worldUrl) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setWorldEnvironment(${JSON.stringify({
          ...(payload.world || {}),
          dataUrl: undefined,
          url: worldUrl
        })})`
      );
    }

    if (imageSplatUrl) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setImageSplatObject(${JSON.stringify({
          ...(payload.imageSplat || {}),
          dataUrl: undefined,
          url: imageSplatUrl
        })})`
      );
    }

    if (videoPlanesForRenderer?.items?.length) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setVideoPlanes(${JSON.stringify(videoPlanesForRenderer)})`
      );
    }

    if (morphTargetUrl) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setMorphTargetModel(${JSON.stringify({
          ...(payload.morphTarget || {}),
          dataUrl: undefined,
          url: morphTargetUrl
        })})`
      );
    }

    const hasCameraKeyframes = Array.isArray(payload.cameraKeyframes) && payload.cameraKeyframes.length > 0;

    if (payload.cameraCurve) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setCameraCurve(${JSON.stringify(payload.cameraCurve.curve)}, ${JSON.stringify(payload.cameraCurve.strength)}, ${JSON.stringify({
          applyToSelected: false
        })})`
      );
      if (payload.cameraCurve.pathMode) {
        await hiddenWindow.webContents.executeJavaScript(
          `window.particleStudio.setCameraPathMode(${JSON.stringify(payload.cameraCurve.pathMode)})`
        );
      }
    }

    if (Array.isArray(payload.cameraKeyframes)) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setCameraKeyframes(${JSON.stringify(payload.cameraKeyframes)})`
      );
    }

    if (Array.isArray(payload.parameterKeyframes)) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setParameterKeyframes(${JSON.stringify(payload.parameterKeyframes)})`
      );
    }

    const cameraSnapshot = format === 'mp4-360'
      ? { ...(payload.cameraSnapshot || {}), cameraType: 'panorama', dofEnabled: false, cameraDofEnabled: false }
      : payload.cameraSnapshot;
    if (cameraSnapshot) {
      await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.setCameraSnapshot(${JSON.stringify(cameraSnapshot)}, ${JSON.stringify({
          pose: !hasCameraKeyframes
        })})`
      );
    }

    await hiddenWindow.webContents.executeJavaScript(
      `window.particleStudio.prepareExportFrame(${JSON.stringify(effectStartTime)}, ${JSON.stringify(cameraStartTime)})`
    );

    for (let frame = 0; frame < frameCount; frame += 1) {
      const frameOffset = frame / fps;
      const effectTime = effectStartTime + frameOffset;
      const cameraTime = cameraStartTime + frameOffset;
      const dataUrl = await hiddenWindow.webContents.executeJavaScript(
        `window.particleStudio.renderFrameAsync(${JSON.stringify(effectTime)}, undefined, ${JSON.stringify(cameraTime)})`
      );
      const png = String(dataUrl).replace(/^data:image\/png;base64,/, '');
      await writeFile(path.join(framesDir, `frame_${String(frame).padStart(5, '0')}.png`), png, 'base64');
    }

    if (format === 'mov') {
      await encodeMov(framesDir, outputPath, fps);
    } else if (format === 'mp4-360') {
      const encodedPath = path.join(framesDir, 'encoded-panorama.mp4');
      await encodeMp4(framesDir, encodedPath, fps);
      await injectSphericalMetadata(encodedPath, outputPath);
    } else {
      await encodeMp4(framesDir, outputPath, fps);
    }
    return {
      ok: true,
      path: outputPath,
      relativePath: outputPath,
      format,
      width,
      height
    };
  } finally {
    if (hiddenWindow && !hiddenWindow.isDestroyed()) {
      hiddenWindow.destroy();
    }

    await rm(framesDir, { recursive: true, force: true });
    await rm(exportModelDir, { recursive: true, force: true });
    exportModelDir = '';
  }
}

async function convertBlendToGlb(payload) {
  const blendPath = path.resolve(String(payload.path || ''));
  if (!blendPath.toLowerCase().endsWith('.blend') || !existsSync(blendPath)) {
    return {
      ok: false,
      error: 'Blend 文件路径无效。'
    };
  }

  const blenderPath = await findBlenderExecutable();
  if (!blenderPath) {
    return {
      ok: false,
      error: '未找到 Blender。请安装 Blender，或把 BLENDER_PATH 指向 blender.exe。'
    };
  }

  const nextRuntimeDir = await mkdtemp(path.join(tmpdir(), 'particle-blend-runtime-'));
  const outputName = `${sanitizeFilename(path.basename(blendPath, '.blend') || 'blend-model')}.glb`;
  const outputPath = path.join(nextRuntimeDir, outputName);
  const scriptPath = path.join(nextRuntimeDir, 'particle_blend_export.py');

  const exporterScript = await readFile(path.join(__dirname, 'blend-exporter.py'), 'utf8');
  await writeFile(scriptPath, exporterScript, 'utf8');

  try {
    const log = await runProcess(
      blenderPath,
      ['--factory-startup', '--background', blendPath, '--python', scriptPath, '--', outputPath],
      {
        cwd: path.dirname(blenderPath),
        timeoutMs: 20 * 60 * 1000
      }
    );

    if (!existsSync(outputPath) || statSync(outputPath).size <= 0) {
      throw new Error('Blender 没有生成可读取的 GLB 文件。');
    }

    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runtimeAssetDirs.add(nextRuntimeDir);
    runtimeAssetMap.set(token, outputPath);

    return {
      ok: true,
      path: outputPath,
      url: `/__runtime-asset/${token}/${encodeURIComponent(outputName)}`,
      name: outputName,
      extension: 'glb',
      size: statSync(outputPath).size,
      blenderPath,
      log: log.slice(-5000)
    };
  } catch (error) {
    await rm(nextRuntimeDir, { recursive: true, force: true });
    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

async function runLocalSharp(payload) {
  const source = payload.source || {};
  const extension = sanitizeImageExtension(source.extension || path.extname(source.name || '').slice(1) || 'png');
  if (!['jpg', 'jpeg', 'png', 'webp', 'hdr', 'exr'].includes(extension)) {
    return {
      ok: false,
      error: 'SHARP input must be an image or panorama file.'
    };
  }

  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'particle-sharp-runtime-'));
  const inputDir = path.join(runtimeDir, 'input');
  const outputDir = path.join(runtimeDir, 'output');
  const inputName = `${sanitizeFilename(path.basename(source.name || `sharp-source.${extension}`, path.extname(source.name || '')) || 'sharp-source')}.${extension}`;
  const inputPath = path.join(inputDir, inputName);

  try {
    await mkdir(inputDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    if (source.path && existsSync(String(source.path))) {
      await copyFile(String(source.path), inputPath);
    } else if (source.dataUrl) {
      const base64 = String(source.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await writeFile(inputPath, Buffer.from(base64, 'base64'));
    } else {
      throw new Error('No readable source image was provided.');
    }

    const sharpCommand = findSharpCommand();
    const args = [
      ...(sharpCommand.argsPrefix || []),
      ...buildSharpPredictArgs(inputDir, outputDir, payload)
    ];
    const log = await runProcess(sharpCommand.command, args, {
      cwd: sharpCommand.cwd,
      timeoutMs: clampNumber(payload.timeoutMs, 60000, 90 * 60 * 1000, 30 * 60 * 1000),
      env: sharpCommand.env
    });

    const outputPath = findNewestFile(outputDir, new Set(['ply', 'splat', 'ksplat', 'spz']));
    if (!outputPath) {
      throw new Error(`SHARP finished but no readable splat file was found.\n${log}`.trim());
    }

    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const outputName = path.basename(outputPath);
    runtimeAssetDirs.add(runtimeDir);
    runtimeAssetMap.set(token, outputPath);

    return {
      ok: true,
      path: outputPath,
      url: `/__runtime-asset/${token}/${encodeURIComponent(outputName)}`,
      name: outputName,
      extension: path.extname(outputPath).slice(1).toLowerCase() || 'ply',
      log: log.slice(-10000),
      command: `${sharpCommand.label} ${args.join(' ')}`
    };
  } catch (error) {
    await rm(runtimeDir, { recursive: true, force: true });
    return {
      ok: false,
      error: formatSharpError(error),
      log: error?.message || String(error)
    };
  }
}

async function checkLocalSharp() {
  const installDir = getSharpInstallRoot();
  const commandInfo = findSharpCommand();

  try {
    const log = await runProcess(commandInfo.command, [
      ...(commandInfo.argsPrefix || []),
      '--help'
    ], {
      cwd: commandInfo.cwd,
      timeoutMs: 20000,
      allowNonZero: true,
      env: commandInfo.env
    });
    const checkpointPath = findSharpCheckpoint();
    const checkpointProblem = describeSharpCheckpointProblem();
    return {
      ok: true,
      available: Boolean(checkpointPath),
      command: commandInfo.command,
      label: commandInfo.label,
      installDir,
      checkpointPath,
      hasCheckpoint: Boolean(checkpointPath),
      checkpointProblem,
      error: checkpointPath ? '' : checkpointProblem,
      log: log.slice(-4000)
    };
  } catch (error) {
    const checkpointPath = findSharpCheckpoint();
    return {
      ok: true,
      available: false,
      command: commandInfo.command,
      installDir,
      checkpointPath,
      hasCheckpoint: Boolean(checkpointPath),
      error: formatSharpError(error)
    };
  }
}

async function installLocalSharp(payload) {
  if (!payload.acceptResearchLicense) {
    return {
      ok: false,
      error: '请先确认 apple/ml-sharp 模型许可。'
    };
  }

  const installDir = path.resolve(String(payload.installDir || getSharpInstallRoot()));
  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'particle-sharp-installer-'));
  const scriptPath = path.join(runtimeDir, 'setup-ml-sharp.ps1');

  try {
    const script = await readFile(path.join(__dirname, 'setup-ml-sharp.ps1'), 'utf8');
    await writeFile(scriptPath, script, 'utf8');
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-InstallDir',
      installDir,
      '-AcceptResearchLicense'
    ];
    if (payload.downloadCheckpoint !== false) {
      args.push('-DownloadCheckpoint');
    }

    const log = await runProcess('powershell.exe', args, {
      cwd: getProcessCwd(),
      timeoutMs: 3 * 60 * 60 * 1000
    });
    const check = await checkLocalSharp();
    return {
      ok: check.available,
      ...check,
      installDir,
      log: `${log}\n${check.log || ''}`.trim().slice(-12000),
      error: check.available ? '' : (check.error || 'SHARP 安装完成但未能通过检测。')
    };
  } catch (error) {
    return {
      ok: false,
      available: false,
      installDir,
      error: error.message || String(error),
      log: error.message || String(error)
    };
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
}

function getSharpInstallRoot() {
  return path.resolve(
    process.env.PARTICLE_SHARP_HOME ||
    process.env.ML_SHARP_HOME ||
    path.join(app.getPath('userData'), 'ml-sharp')
  );
}

function getSharpRuntimeRoots() {
  const installRoot = getSharpInstallRoot();
  const portableRoot = process.execPath ? path.dirname(process.execPath) : '';
  const resourceRoot = process.resourcesPath || '';
  return [
    path.join(resourceRoot, 'tools', 'ml-sharp'),
    path.join(portableRoot, 'tools', 'ml-sharp'),
    path.join(appRoot, 'tools', 'ml-sharp'),
    path.join(appRoot, 'ml-sharp'),
    installRoot
  ].filter((value, index, list) => value && list.indexOf(value) === index);
}

function findSharpCommand() {
  const explicit =
    process.env.PARTICLE_SHARP_EXE ||
    process.env.ML_SHARP_EXE ||
    process.env.SHARP_EXE ||
    '';
  const cwd = process.env.PARTICLE_SHARP_DIR || process.env.ML_SHARP_DIR || getProcessCwd();
  const env = { ...process.env };

  if (process.env.PARTICLE_SHARP_PYTHON || process.env.ML_SHARP_PYTHON) {
    env.PYTHON = process.env.PARTICLE_SHARP_PYTHON || process.env.ML_SHARP_PYTHON;
  }

  if (explicit) {
    return {
      command: explicit,
      cwd,
      env,
      label: path.basename(explicit)
    };
  }

  const sharpRoots = getSharpRuntimeRoots();
  const bundledPython = sharpRoots
    .map((root) => {
      const pythonExe = path.join(root, 'python', 'python.exe');
      const runner = path.join(root, 'run-sharp.py');
      const sitePackages = path.join(root, '.venv', 'Lib', 'site-packages');
      const sourcePath = path.join(root, 'source', 'src');
      if (!existsSync(pythonExe) || !existsSync(runner) || !existsSync(sitePackages) || !existsSync(sourcePath)) {
        return null;
      }
      const portableEnv = { ...env };
      portableEnv.PYTHONPATH = [
        sitePackages,
        sourcePath,
        portableEnv.PYTHONPATH || ''
      ].filter(Boolean).join(path.delimiter);
      portableEnv.PATH = [
        path.dirname(pythonExe),
        path.join(root, '.venv', 'Scripts'),
        sitePackages,
        portableEnv.PATH || ''
      ].filter(Boolean).join(path.delimiter);
      return {
        command: pythonExe,
        argsPrefix: [runner],
        cwd: root,
        env: portableEnv,
        label: 'bundled-python sharp'
      };
    })
    .find(Boolean);
  if (bundledPython) {
    return bundledPython;
  }

  const localCandidates = sharpRoots.flatMap((root) => [
    path.join(root, '.venv', 'Scripts', 'sharp.exe'),
    path.join(root, '.venv', 'Scripts', 'sharp.cmd'),
    path.join(root, '.venv', 'Scripts', 'sharp.bat'),
    path.join(root, 'venv', 'Scripts', 'sharp.exe'),
    path.join(root, 'venv', 'Scripts', 'sharp.cmd'),
    path.join(root, 'venv', 'Scripts', 'sharp.bat'),
    path.join(root, 'Scripts', 'sharp.exe'),
    path.join(root, 'Scripts', 'sharp.cmd'),
    path.join(root, 'Scripts', 'sharp.bat')
  ]);
  const local = localCandidates.find((candidate) => existsSync(candidate));
  if (local) {
    return {
      command: local,
      cwd: path.dirname(path.dirname(local)),
      env,
      label: path.basename(local)
    };
  }

  return {
    command: 'sharp',
    cwd,
    env,
    label: 'sharp'
  };
}

function buildSharpPredictArgs(inputDir, outputDir, payload = {}) {
  const args = ['predict', '-i', inputDir, '-o', outputDir];
  const checkpoint = payload.checkpoint ||
    process.env.PARTICLE_SHARP_CHECKPOINT ||
    process.env.ML_SHARP_CHECKPOINT ||
    findSharpCheckpoint();
  if (!isValidSharpCheckpoint(checkpoint)) {
    throw new Error(describeSharpCheckpointProblem());
  }
  args.push('-c', String(checkpoint));
  return args;
}

function getSharpCheckpointCandidates() {
  const runtimeCandidates = getSharpRuntimeRoots().flatMap((root) => [
    path.join(root, 'checkpoints', 'sharp_2572gikvuh.pt'),
    path.join(root, 'source', 'checkpoints', 'sharp_2572gikvuh.pt')
  ]);
  return [
    process.env.PARTICLE_SHARP_CHECKPOINT,
    process.env.ML_SHARP_CHECKPOINT,
    ...runtimeCandidates,
    path.join(homedir(), '.cache', 'torch', 'hub', 'checkpoints', 'sharp_2572gikvuh.pt')
  ].filter(Boolean);
}

function findSharpCheckpoint() {
  return getSharpCheckpointCandidates().find((candidate) => isValidSharpCheckpoint(candidate)) || '';
}

function isValidSharpCheckpoint(candidate) {
  if (!candidate || !existsSync(candidate)) {
    return false;
  }
  return statSync(candidate).size >= MIN_SHARP_CHECKPOINT_BYTES;
}

function describeSharpCheckpointProblem() {
  const existing = getSharpCheckpointCandidates()
    .filter((candidate) => candidate && existsSync(candidate))
    .map((candidate) => ({ path: candidate, size: statSync(candidate).size }))
    .sort((a, b) => b.size - a.size)[0];

  if (existing) {
    const sizeMb = Math.round(existing.size / (1024 * 1024));
    return `SHARP checkpoint 不完整：${path.basename(existing.path)} 只有 ${sizeMb}MB。请在软件内安装/修复 SHARP，或重新打包完整 tools/ml-sharp/checkpoints/sharp_2572gikvuh.pt。`;
  }

  return '未找到完整 SHARP checkpoint。请在软件内安装/修复 SHARP，或把完整 tools/ml-sharp 运行时一起打包进 exe。';
}

function findNewestFile(root, extensions, newest = null) {
  if (!existsSync(root)) {
    return newest?.path || '';
  }

  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nestedPath = findNewestFile(nextPath, extensions, newest);
      if (nestedPath) {
        const nestedStat = statSync(nestedPath);
        if (!newest || nestedStat.mtimeMs > newest.mtimeMs) {
          newest = { path: nestedPath, mtimeMs: nestedStat.mtimeMs };
        }
      }
      continue;
    }

    const extension = path.extname(entry.name).slice(1).toLowerCase();
    if (!extensions.has(extension)) {
      continue;
    }
    const fileStat = statSync(nextPath);
    if (fileStat.size <= 0) {
      continue;
    }
    if (!newest || fileStat.mtimeMs > newest.mtimeMs) {
      newest = { path: nextPath, mtimeMs: fileStat.mtimeMs };
    }
  }

  return newest?.path || '';
}

function formatSharpError(error) {
  const message = error?.message || String(error);
  if (/ENOENT|not found|not recognized|spawn sharp/i.test(message)) {
    return [
      '未找到本地 SHARP 命令。',
      '可把完整运行时放到 exe 资源目录的 tools/ml-sharp，或在软件内安装到用户数据目录。',
      '也可以设置 PARTICLE_SHARP_EXE / ML_SHARP_EXE 指向 sharp.exe；未安装时内置图片点云仍可直接使用。'
    ].join('\n');
  }
  return message;
}

async function waitForRendererReady(window) {
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        if (window.particleStudio?.isReady?.()) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt > 60000) {
          reject(new Error('Renderer did not become ready for export.'));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    })
  `);
}

async function encodeMov(framesDir, outputPath, fps) {
  const inputPattern = path.join(framesDir, 'frame_%05d.png');
  const ffmpegPath = getFfmpegPath();
  const args = [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    inputPattern,
    '-vf',
    'format=rgba',
    '-c:v',
    'prores_ks',
    '-profile:v',
    '4',
    '-pix_fmt',
    'yuva444p10le',
    '-vendor',
    'apl0',
    '-alpha_bits',
    '16',
    outputPath
  ];

  const child = spawn(ffmpegPath, args, {
    cwd: app.isPackaged ? path.dirname(ffmpegPath) : appRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, 'exit');

  if (code !== 0) {
    throw new Error(stderr || `FFmpeg exited with code ${code}`);
  }
}

async function encodeMp4(framesDir, outputPath, fps) {
  const inputPattern = path.join(framesDir, 'frame_%05d.png');
  const ffmpegPath = getFfmpegPath();
  const args = [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    inputPattern,
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    outputPath
  ];

  const child = spawn(ffmpegPath, args, {
    cwd: app.isPackaged ? path.dirname(ffmpegPath) : appRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, 'exit');

  if (code !== 0) {
    throw new Error(stderr || `FFmpeg exited with code ${code}`);
  }
}

function normalizeExportFormat(value) {
  return value === 'mp4-360' ? 'mp4-360' : value === 'mp4' ? 'mp4' : 'mov';
}

function getFfmpegPath() {
  if (!ffmpegStaticPath) {
    throw new Error('FFmpeg binary was not found.');
  }

  if (app.isPackaged) {
    return ffmpegStaticPath.replace('app.asar', 'app.asar.unpacked');
  }

  return ffmpegStaticPath;
}

async function findBlenderExecutable() {
  const directCandidates = [
    process.env.BLENDER_PATH,
    process.env.BLENDER_EXE,
    path.join(appRoot, 'blender', 'blender.exe'),
    path.join(process.resourcesPath || '', 'blender', 'blender.exe')
  ].filter(Boolean);

  for (const candidate of directCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const fromPath = await findExecutableInPath('blender.exe');
  if (fromPath) {
    return fromPath;
  }

  const fromRegistry = await findBlenderFromRegistry();
  if (fromRegistry) {
    return fromRegistry;
  }

  const roots = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Blender Foundation'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Blender Foundation'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Blender Foundation'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Blender')
  ].filter(Boolean);

  for (const root of roots) {
    const found = findFileByName(root, 'blender.exe', 4);
    if (found) {
      return found;
    }
  }

  return '';
}

async function findBlenderFromRegistry() {
  if (process.platform !== 'win32') {
    return '';
  }

  const command = [
    "$roots = @(",
    "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    ");",
    "foreach ($root in $roots) {",
    "  Get-ItemProperty $root -ErrorAction SilentlyContinue |",
    "    Where-Object { $_.DisplayName -like '*Blender*' } |",
    "    ForEach-Object {",
    "      if ($_.InstallLocation) { Join-Path $_.InstallLocation 'blender.exe' }",
    "      if ($_.DisplayIcon) { ($_.DisplayIcon -replace ',\\d+$','') }",
    "    }",
    "}"
  ].join(' ');

  try {
    const output = await runProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd: getProcessCwd(),
      timeoutMs: 12000,
      allowNonZero: true
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^"|"$/g, ''))
      .find((line) => line.toLowerCase().endsWith('blender.exe') && existsSync(line)) || '';
  } catch {
    return '';
  }
}

async function findExecutableInPath(executableName) {
  if (process.platform !== 'win32') {
    return '';
  }

  try {
    const output = await runProcess('where.exe', [executableName], {
      cwd: getProcessCwd(),
      timeoutMs: 8000,
      allowNonZero: true
    });
    return output.split(/\r?\n/).map((line) => line.trim()).find((line) => line && existsSync(line)) || '';
  } catch {
    return '';
  }
}

function findFileByName(root, filename, maxDepth) {
  if (!root || maxDepth < 0 || !existsSync(root)) {
    return '';
  }

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return '';
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const lowerName = entry.name.toLowerCase();
    if (
      maxDepth <= 1 &&
      !lowerName.includes('blender') &&
      !lowerName.includes('foundation')
    ) {
      continue;
    }
    const found = findFileByName(path.join(root, entry.name), filename, maxDepth - 1);
    if (found) {
      return found;
    }
  }

  return '';
}

async function runProcess(command, args, options = {}) {
  const {
    cwd = getProcessCwd(),
    timeoutMs = 120000,
    allowNonZero = false,
    env = process.env
  } = options;

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const timeout = setTimeout(() => {
    child.kill();
  }, timeoutMs);

  try {
    const [code] = await Promise.race([
      once(child, 'exit'),
      once(child, 'error').then(([error]) => {
        throw error;
      })
    ]);
    const output = `${stdout}\n${stderr}`.trim();
    if (code !== 0 && !allowNonZero) {
      throw new Error(output || `${path.basename(command)} exited with code ${code}`);
    }
    return output;
  } finally {
    clearTimeout(timeout);
  }
}

function getProcessCwd() {
  return app.isPackaged ? path.dirname(process.execPath) : appRoot;
}

function isInside(root, target) {
  if (!root) {
    return false;
  }

  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

function sanitizeVideoExtension(value) {
  const extension = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['mp4', 'mov', 'm4v', 'webm'].includes(extension) ? extension : 'mp4';
}

function timestampName() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}
