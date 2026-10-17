// Minimal read-only ZIP (jar) reader working on random-access reads, so huge mod
// jars never have to be loaded into memory: only the central directory and the
// entries actually needed are read. Inflate uses the platform's DecompressionStream.

export interface RandomAccessFile {
  readonly name: string;
  size(): Promise<number>;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;

const decoder = new TextDecoder();

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Reads the central directory. `keep` filters entry names early to save memory. */
export async function readZipDirectory(file: RandomAccessFile, keep: (name: string) => boolean = () => true): Promise<ZipEntry[]> {
  const size = await file.size();
  const tailLength = Math.min(size, 0xffff + 22);
  const tailStart = size - tailLength;
  const tail = await file.read(tailStart, tailLength);
  const tv = view(tail);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${file.name}: not a ZIP file (end of central directory not found)`);

  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);

  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || tv.getUint32(locator, true) !== ZIP64_LOCATOR) throw new Error(`${file.name}: bozuk ZIP64`);
    const zip64Offset = Number(tv.getBigUint64(locator + 8, true));
    const z = view(await file.read(zip64Offset, 56));
    if (z.getUint32(0, true) !== ZIP64_EOCD) throw new Error(`${file.name}: bozuk ZIP64`);
    cdSize = Number(z.getBigUint64(40, true));
    cdOffset = Number(z.getBigUint64(48, true));
  }

  const cd = await file.read(cdOffset, cdSize);
  const v = view(cd);
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && v.getUint32(p, true) === CENTRAL) {
    const nameLength = v.getUint16(p + 28, true);
    const extraLength = v.getUint16(p + 30, true);
    const commentLength = v.getUint16(p + 32, true);
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLength));
    if (keep(name)) {
      let compressedSize = v.getUint32(p + 20, true);
      let uncompressed = v.getUint32(p + 24, true);
      let localHeaderOffset = v.getUint32(p + 42, true);
      // ZIP64 sizes live in the extra field (id 0x0001), in this order, only for maxed-out values.
      if (compressedSize === 0xffffffff || uncompressed === 0xffffffff || localHeaderOffset === 0xffffffff) {
        let e = p + 46 + nameLength;
        const end = e + extraLength;
        while (e + 4 <= end) {
          const id = v.getUint16(e, true);
          const len = v.getUint16(e + 2, true);
          if (id === 1) {
            let q = e + 4;
            if (uncompressed === 0xffffffff) (uncompressed = Number(v.getBigUint64(q, true))), (q += 8);
            if (compressedSize === 0xffffffff) (compressedSize = Number(v.getBigUint64(q, true))), (q += 8);
            if (localHeaderOffset === 0xffffffff) localHeaderOffset = Number(v.getBigUint64(q, true));
          }
          e += 4 + len;
        }
      }
      entries.push({ name, method: v.getUint16(p + 10, true), compressedSize, size: uncompressed, localHeaderOffset });
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readZipEntry(file: RandomAccessFile, entry: ZipEntry): Promise<Uint8Array> {
  const header = await file.read(entry.localHeaderOffset, 30);
  const hv = view(header);
  if (hv.getUint32(0, true) !== LOCAL) throw new Error(`${file.name}: corrupt local header for ${entry.name}`);
  const dataStart = entry.localHeaderOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const data = await file.read(dataStart, entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new Error(`${file.name}: unsupported compression (${entry.method}) for ${entry.name}`);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Random access over a Blob/File (browser File System Access API). */
export function blobFile(blob: Blob, name: string): RandomAccessFile {
  return {
    name,
    size: async () => blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}
