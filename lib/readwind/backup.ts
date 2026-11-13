import { z } from "zod";

import { book, annotation, progress, settings, timestamp } from "./schemas";

import { safeId } from "./security";

import { validateFile } from "./file-validation";

const maxBackup = 80 * 1024 * 1024;

const schema = z.object({
  format: z.literal("folio-backup-1"),
  books: z.array(book).max(1000),

  annotations: z.array(annotation).max(10000).default([]),

  progress: z
    .array(progress.extend({ updatedAt: timestamp }))
    .max(1000)
    .default([]),

  settings: settings.optional(),

  blobs: z
    .array(
      z.object({
        id: z.string().regex(safeId),
        type: z.string().max(100).optional(),
        data: z.string().max(28 * 1024 * 1024),
      }),
    )
    .max(2000)
    .default([]),
});

export function decodeBackup(input: unknown, suppliedFiles?: {id:string;blob:Blob}[]) {
  const parsed = schema.safeParse(input);

  if (!parsed.success)
    throw new Error("This backup contains invalid or excessive library data.");

  const data = parsed.data;

  const ids = new Set(data.books.map((b) => b.id));

  if (
    ids.size !== data.books.length ||
    data.annotations.some((a) => !ids.has(a.bookId)) ||
    data.progress.some((p) => !ids.has(p.bookId))
  )
    throw new Error("Invalid backup references.");

  const books = new Map(data.books.map((b) => [b.id, b]));
  const valid = (
    id: string,
    at: { section: number; block: number; offset: number },
  ) => {
    const block = books.get(id)?.sections[at.section]?.blocks[at.block];
    return !!block && at.offset <= (block.text?.length || 0);
  };
  if (
    data.annotations.some(
      (a) => !valid(a.bookId, a.range.start) || !valid(a.bookId, a.range.end),
    ) ||
    data.progress.some((p) => !valid(p.bookId, p.at))
  )
    throw new Error("Invalid backup reading position.");
  const files = suppliedFiles || data.blobs.map((b) => {
    // Decode bytes directly. Never fetch a URL supplied by an archive.

    const match =
      /^data:(application\/pdf|application\/epub\+zip|text\/plain|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
        b.data,
      );

    if (!match || (b.type && b.type !== match[1]))
      throw new Error("Backup contains an unsupported attachment.");

    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

    if (bytes.length > 20 * 1024 * 1024)
      throw new Error("Backup attachment exceeds 20 MB.");

    validateFile(bytes, match[1]);

    return { id: b.id, blob: new Blob([bytes], { type: match[1] }) };
  });

  if (new Set(files.map((f) => f.id)).size !== files.length)
    throw new Error("Duplicate attachment ID.");

  const lookup = new Map(files.map((f) => [f.id, f.blob]));

  for (const b of data.books) {
    if (
      b.sourcePdfBlobId &&
      lookup.get(b.sourcePdfBlobId)?.type !== "application/pdf"
    )
      throw new Error("Original attachment must be a PDF.");

    if(b.sourceBlobId && !['application/epub+zip','text/plain'].includes(lookup.get(b.sourceBlobId)?.type||''))throw new Error('Invalid source attachment.');
    const images = [
      b.cover.blobId,
      b.pdfCoverBlobId,
      b.customCoverBlobId,
      ...b.sections.flatMap((s) =>
        s.blocks.map((block) =>
          block.type === "figure" ? block.blobId : undefined,
        ),
      ),
    ].filter(Boolean) as string[];

    if (images.some((id) => !lookup.get(id)?.type.startsWith("image/")))
      throw new Error("Invalid image attachment.");
  }

  return { data, files };
}

function base64(bytes: Uint8Array) {
  let text = "";

  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));

  return btoa(text);
}

async function key(password: string, salt: Uint8Array) {
  if (password.length < 12)
    throw new Error("Use a backup password with at least 12 characters.");

  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations: 600000,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBackup(json: string, password: string) {
  if (new TextEncoder().encode(json).length > maxBackup)
    throw new Error("Backup exceeds 80 MB. Export a smaller library.");

  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(password, salt),
    new TextEncoder().encode(json),
  );

  return JSON.stringify({
    format: "readwind-encrypted-1",
    salt: base64(salt),
    iv: base64(iv),
    data: base64(new Uint8Array(encrypted)),
  });
}

export async function readBackup(file: File, password: () => string | null | Promise<string | null>) {
  if(await file.slice(0,8).text()==='RDWIND02')return readArchive(file,password);
  if (file.size > 115 * 1024 * 1024) throw new Error("Backup exceeds 115 MB.");

  let input = JSON.parse(await file.text());

  if (input?.format === "readwind-encrypted-1") {
    const envelope = z
      .object({
        format: z.literal("readwind-encrypted-1"),
        salt: z.string().length(24),
        iv: z.string().length(16),
        data: z.string().max(112 * 1024 * 1024),
      })
      .parse(input);

    const secret = await password();

    if (!secret) throw new Error("Restore cancelled.");

    try {
      const bytes = (s: string) =>
        Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes(envelope.iv) },
        await key(secret, bytes(envelope.salt)),
        bytes(envelope.data),
      );

      input = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error("Incorrect password or damaged backup.");
    }
  }

  return decodeBackup(input);
}


// Binary v2: a small authenticated manifest followed by independently encrypted
// 1 MiB frames. Frame order is authenticated; no base64 copies of attachments.
const frameSize=1024*1024;
const maxArchive=650*1024*1024;
type ArchiveData={format:'folio-backup-1';books:import('./types').Book[];annotations:import('./types').Annotation[];progress:import('./types').Progress[];settings?:import('./types').Settings};
export async function createArchive(data: ArchiveData, files: {id:string;blob?:Blob;load?:()=>Promise<Blob>}[], password:string, sink?:{write:(part:BlobPart)=>Promise<void>}) {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const secret=await key(password,salt);
  const parts:BlobPart[]=[];
  const append=async(part:BlobPart)=>{if(sink)await sink.write(part);else parts.push(part instanceof Blob?part:new Blob([part]));};
  await append('RDWIND02');await append(salt);
  const load=async(file:typeof files[number])=>{const blob=file.blob || await file.load?.();if(!blob)throw new Error('A backup attachment is unavailable.');return blob;};
  let counter=0,total=24;
  async function frame(bytes:Uint8Array){
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const additionalData=new TextEncoder().encode(String(counter++));
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},secret,bytes as BufferSource);
    const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,cipher.byteLength);
    total+=16+cipher.byteLength;if(total>maxArchive)throw new Error('Backup exceeds 650 MiB. Select fewer books.');
    await append(length);await append(iv);await append(cipher);
  }
  const entries=[];
  for(const file of files){
    const blob=await load(file);
    if(blob.size>20*1024*1024)throw new Error('Backup attachment exceeds 20 MiB.');
    const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
    entries.push({id:file.id,type:blob.type,bytes:blob.size,sha256:base64(new Uint8Array(hash))});
  }
  const manifest=new TextEncoder().encode(JSON.stringify({...data,blobs:[],attachments:entries}));
  if(manifest.length>80*1024*1024)throw new Error('Book metadata exceeds 80 MiB. Select fewer books.');
  // The manifest length is authenticated inside its first frame.
  await frame(new TextEncoder().encode(String(manifest.length)));
  for(let i=0;i<manifest.length;i+=frameSize)await frame(manifest.subarray(i,i+frameSize));
  for(const file of files){const blob=await load(file);for(let i=0;i<blob.size;i+=frameSize)
    await frame(new Uint8Array(await blob.slice(i,i+frameSize).arrayBuffer()));}
  return new Blob(parts,{type:'application/octet-stream'});
}
async function readArchive(file:File,password:()=>string|null|Promise<string|null>){
  if(file.size>maxArchive)throw new Error('Backup exceeds 650 MiB.');
  const supplied=await password();if(!supplied)throw new Error('Restore cancelled.');
  let offset=24,counter=0;
  const secret=await key(supplied,new Uint8Array(await file.slice(8,24).arrayBuffer()));
  async function frame(){
    if(offset+16>file.size)throw new Error('Truncated backup.');
    const header=await file.slice(offset,offset+16).arrayBuffer();
    const size=new DataView(header).getUint32(0);
    if(size<16 || size>frameSize+16 || offset+16+size>file.size)throw new Error('Invalid backup frame.');
    offset+=16;
    let plain:ArrayBuffer;
    try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(header,4,12),additionalData:new TextEncoder().encode(String(counter++))},secret,await file.slice(offset,offset+size).arrayBuffer());}
    catch{throw new Error('Incorrect password or damaged backup.');}
    offset+=size;return new Uint8Array(plain);
  }
  const length=Number(new TextDecoder().decode(await frame()));
  if(!Number.isSafeInteger(length)||length<=0||length>80*1024*1024)throw new Error('Invalid backup manifest.');
  const bytes=new Uint8Array(length);let written=0;
  while(written<length){const next=await frame();if(!next.length||written+next.length>length)throw new Error('Invalid manifest size.');bytes.set(next,written);written+=next.length;}
  const manifest=JSON.parse(new TextDecoder().decode(bytes));
  const entries=z.array(z.object({id:z.string().regex(safeId),type:z.enum(['application/pdf','application/epub+zip','text/plain','image/png','image/jpeg','image/webp']),bytes:z.number().int().min(1).max(20*1024*1024),sha256:z.string().length(44)})).max(2000).parse(manifest.attachments);
  const files=[];
  for(const entry of entries){
    const chunks:BlobPart[]=[];let size=0;
    while(size<entry.bytes){const chunk=await frame();if(!chunk.length||size+chunk.length>entry.bytes)throw new Error('Invalid attachment size.');chunks.push(chunk as BlobPart);size+=chunk.length;}
    const blob=new Blob(chunks,{type:entry.type}),raw=new Uint8Array(await blob.arrayBuffer());
    if(base64(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)))!==entry.sha256)throw new Error('Damaged backup attachment.');
    validateFile(raw,entry.type);files.push({id:entry.id,blob});
  }
  if(offset!==file.size)throw new Error('Unexpected trailing backup data.');
  return decodeBackup(manifest,files);
}
