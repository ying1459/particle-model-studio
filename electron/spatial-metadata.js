import { readFile, writeFile } from 'node:fs/promises';

const SPHERICAL_UUID_ID = Buffer.from('ffcc8263f8554a938814587a02521fdd', 'hex');
const VIDEO_SAMPLE_ENTRY_TYPES = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'mp4v']);

const SPHERICAL_XML = [
  '<?xml version="1.0"?>',
  '<rdf:SphericalVideo',
  'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
  'xmlns:GSpherical="http://ns.google.com/videos/1.0/spherical/">',
  '<GSpherical:Spherical>true</GSpherical:Spherical>',
  '<GSpherical:Stitched>true</GSpherical:Stitched>',
  '<GSpherical:StitchingSoftware>Particle Model Studio</GSpherical:StitchingSoftware>',
  '<GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType>',
  '</rdf:SphericalVideo>'
].join('\n');

export async function injectSphericalMetadata(inputPath, outputPath = inputPath) {
  const source = await readFile(inputPath);
  const topLevel = readBoxes(source, 0, source.length);
  const moov = topLevel.find((box) => box.type === 'moov');
  const mdat = topLevel.find((box) => box.type === 'mdat');

  if (!moov) {
    throw new Error('360 metadata injection failed: MP4 does not contain a moov box.');
  }
  if (mdat && moov.start < mdat.start) {
    throw new Error('360 metadata injection requires a non-faststart MP4 (moov must follow mdat).');
  }

  const videoTrack = findVideoTrack(source, moov);
  if (!videoTrack) {
    throw new Error('360 metadata injection failed: video track was not found.');
  }

  const stsd = findDescendant(source, videoTrack.mdia, ['minf', 'stbl', 'stsd']);
  if (!stsd) {
    throw new Error('360 metadata injection failed: video sample description was not found.');
  }

  const sampleEntry = findVideoSampleEntry(source, stsd);
  if (!sampleEntry) {
    throw new Error('360 metadata injection failed: unsupported video sample entry.');
  }

  const sphericalV2 = createSphericalV2Boxes();
  const sphericalV1 = makeBox('uuid', SPHERICAL_UUID_ID, Buffer.from(SPHERICAL_XML, 'utf8'));
  const patched = Buffer.from(source);

  incrementBoxSize(patched, sampleEntry, sphericalV2.length);
  incrementBoxSize(patched, stsd, sphericalV2.length);

  const stbl = findParentAlongPath(source, videoTrack.mdia, ['minf', 'stbl']);
  const minf = findParentAlongPath(source, videoTrack.mdia, ['minf']);
  for (const box of [stbl, minf, videoTrack.mdia]) {
    incrementBoxSize(patched, box, sphericalV2.length);
  }

  incrementBoxSize(patched, videoTrack.trak, sphericalV2.length + sphericalV1.length);
  incrementBoxSize(patched, moov, sphericalV2.length + sphericalV1.length);

  const insertions = [
    { offset: sampleEntry.end, data: sphericalV2 },
    { offset: videoTrack.trak.end, data: sphericalV1 }
  ].sort((a, b) => b.offset - a.offset);

  let result = patched;
  for (const insertion of insertions) {
    result = Buffer.concat([
      result.subarray(0, insertion.offset),
      insertion.data,
      result.subarray(insertion.offset)
    ]);
  }

  await writeFile(outputPath, result);
  return {
    path: outputPath,
    bytesAdded: sphericalV2.length + sphericalV1.length,
    projection: 'equirectangular',
    stereoMode: 'mono'
  };
}

function createSphericalV2Boxes() {
  const st3d = makeFullBox('st3d', Buffer.from([0]));
  const sourceName = Buffer.from('Particle Model Studio\0', 'utf8');
  const svhd = makeFullBox('svhd', sourceName);
  const prhdBody = Buffer.alloc(12);
  const prhd = makeFullBox('prhd', prhdBody);
  const equiBody = Buffer.alloc(16);
  const equi = makeFullBox('equi', equiBody);
  const proj = makeBox('proj', prhd, equi);
  const sv3d = makeBox('sv3d', svhd, proj);
  return Buffer.concat([st3d, sv3d]);
}

function makeFullBox(type, body) {
  return makeBox(type, Buffer.alloc(4), body);
}

function makeBox(type, ...parts) {
  const contentLength = parts.reduce((total, part) => total + part.length, 0);
  const box = Buffer.alloc(8 + contentLength);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, 4, 'ascii');
  let offset = 8;
  for (const part of parts) {
    part.copy(box, offset);
    offset += part.length;
  }
  return box;
}

function findVideoTrack(buffer, moov) {
  for (const trak of readBoxes(buffer, moov.contentStart, moov.end).filter((box) => box.type === 'trak')) {
    const mdia = readBoxes(buffer, trak.contentStart, trak.end).find((box) => box.type === 'mdia');
    if (!mdia) {
      continue;
    }
    const hdlr = readBoxes(buffer, mdia.contentStart, mdia.end).find((box) => box.type === 'hdlr');
    if (hdlr && hdlr.contentStart + 12 <= hdlr.end && buffer.toString('ascii', hdlr.contentStart + 8, hdlr.contentStart + 12) === 'vide') {
      return { trak, mdia };
    }
  }
  return null;
}

function findDescendant(buffer, root, path) {
  let current = root;
  for (const type of path) {
    current = readBoxes(buffer, current.contentStart, current.end).find((box) => box.type === type);
    if (!current) {
      return null;
    }
  }
  return current;
}

function findParentAlongPath(buffer, root, path) {
  return findDescendant(buffer, root, path);
}

function findVideoSampleEntry(buffer, stsd) {
  if (stsd.contentStart + 8 > stsd.end) {
    return null;
  }
  const entryCount = buffer.readUInt32BE(stsd.contentStart + 4);
  let offset = stsd.contentStart + 8;
  for (let index = 0; index < entryCount && offset + 8 <= stsd.end; index += 1) {
    const [entry] = readBoxes(buffer, offset, stsd.end, 1);
    if (!entry) {
      break;
    }
    if (VIDEO_SAMPLE_ENTRY_TYPES.has(entry.type)) {
      return entry;
    }
    offset = entry.end;
  }
  return null;
}

function readBoxes(buffer, start, end, limit = Number.POSITIVE_INFINITY) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end && boxes.length < limit) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) {
        break;
      }
      const extendedSize = buffer.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('360 metadata injection failed: MP4 box is too large.');
      }
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) {
      break;
    }
    boxes.push({
      start: offset,
      end: offset + size,
      size,
      type,
      headerSize,
      contentStart: offset + headerSize
    });
    offset += size;
  }
  return boxes;
}

function incrementBoxSize(buffer, box, delta) {
  if (!box) {
    return;
  }
  if (box.headerSize === 16) {
    buffer.writeBigUInt64BE(BigInt(box.size + delta), box.start + 8);
    return;
  }
  const nextSize = box.size + delta;
  if (nextSize > 0xffffffff) {
    throw new Error('360 metadata injection failed: MP4 box exceeds 32-bit size.');
  }
  buffer.writeUInt32BE(nextSize, box.start);
}
