import type { Page } from 'tesseract.js';
import { dominantSize, normalizePdfText, type PdfLine } from './pdf-layout';
import { repairOcrText } from './text-cleanup';

/** Stretch a faint scan's luminance without binarizing away fine punctuation. */
export function enhanceOcrContrast(canvas: HTMLCanvasElement) {
  const ctx=canvas.getContext('2d', {willReadFrequently:true});
  if (!ctx) return;
  const image=ctx.getImageData(0,0,canvas.width,canvas.height), histogram=new Uint32Array(256);
  for(let i=0;i<image.data.length;i+=4) {
    const value=Math.round(.299*image.data[i]+.587*image.data[i+1]+.114*image.data[i+2]);
    image.data[i]=image.data[i+1]=image.data[i+2]=value;histogram[value]++;
  }
  const pixels=canvas.width*canvas.height;
  let count=0, low=0, high=255;
  for(let i=0;i<256;i++){count+=histogram[i];if(count>=pixels*.001){low=i;break;}}
  count=0;
  for(let i=255;i>=0;i--){count+=histogram[i];if(count>=pixels*.01){high=i;break;}}
  if(high-low>=15 && high-low<220) for(let i=0;i<image.data.length;i+=4) {
    const value=Math.max(0,Math.min(255,(image.data[i]-low)*255/(high-low)));
    image.data[i]=image.data[i+1]=image.data[i+2]=value;
  }
  ctx.putImageData(image,0,0);
}

export type OcrWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;

/** Each worker is a separate WASM engine (~100-200 MB), so stay modest on small devices. */
export function ocrWorkerCount(cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4, memoryGb = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory) {
  if (memoryGb !== undefined && memoryGb < 4) return 1;
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

/**
 * Lazily grown pool of recognition workers. Jobs hold a worker for their whole
 * run, so per-page parameters set inside a job can never leak into another.
 */
export class OcrPool {
  private workers: OcrWorker[] = [];
  private idle: OcrWorker[] = [];
  private waiting: { resolve: (worker: OcrWorker) => void; reject: (error: unknown) => void }[] = [];
  private creating = 0;
  private closed = false;
  started = false;
  constructor(private create: () => Promise<OcrWorker>, readonly size: number) {}
  private active = new Set<Promise<unknown>>();
  async run<T>(job: (worker: OcrWorker) => Promise<T>): Promise<T> {
    const worker = await this.acquire();
    const running = (async () => { try { return await job(worker); } finally { this.release(worker); } })();
    const tracked = running.catch(() => {});
    this.active.add(tracked);
    void tracked.then(() => this.active.delete(tracked));
    return running;
  }
  private acquire(): Promise<OcrWorker> {
    if (this.closed) return Promise.reject(new DOMException('Import cancelled', 'AbortError'));
    const idle = this.idle.pop();
    if (idle) return Promise.resolve(idle);
    if (this.workers.length + this.creating < this.size) {
      this.started = true;
      this.creating++;
      return this.create().then(worker => {
        this.creating--;
        if (this.closed) { void worker.terminate().catch(() => {}); throw new DOMException('Import cancelled', 'AbortError'); }
        this.workers.push(worker);
        return worker;
      }, error => {
        this.creating--;
        // With no worker to ever hand over, queued jobs would wait forever.
        if (!this.workers.length && !this.creating) for (const waiter of this.waiting.splice(0)) waiter.reject(error);
        throw error;
      });
    }
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
  private release(worker: OcrWorker) {
    const next = this.waiting.shift();
    if (next) next.resolve(worker); else this.idle.push(worker);
  }
  async terminate() {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) waiter.reject(new DOMException('Import cancelled', 'AbortError'));
    // Stopping an engine mid-recognition makes the library throw outside any caller's reach, so let running pages finish.
    await Promise.all([...this.active]);
    await Promise.all(this.workers.splice(0).map(worker => worker.terminate().catch(() => {})));
    this.idle = [];
  }
}

export function ocrScore(data: Pick<Page, 'text' | 'confidence'>) {
  const text = data.text.trim();
  if (!text || !Number.isFinite(data.confidence)) return 0;
  const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return Math.max(0, data.confidence) * Math.min(1, letters / Math.max(1, text.replace(/\s/g, '').length) / .65);
}

export function ocrLines(data: Page, width: number, height: number, rasterWidth: number, rasterHeight: number, page: number): PdfLine[] {
  const sx = width / rasterWidth, sy = height / rasterHeight;
  const lines = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.map((l,index) => {
    const heights=l.words?.filter(w=>w.text.trim().length>1).map(w=>({text:w.text,size:(w.bbox.y1-w.bbox.y0)*sy})) || [];
    const y = l.bbox.y1 * sy, size = heights.length ? dominantSize(heights) : Math.max(1, (l.bbox.y1-l.bbox.y0)*sy);
    return { text:repairOcrText(normalizePdfText(l.text).trim()), x:l.bbox.x0*sx, endX:l.bbox.x1*sx, y, size, page, ocr:true, paragraphStart:index===0, header:y < height*.08 || l.bbox.y0*sy > height*.92 };
  }))).filter(l => l.text);
  const body=dominantSize(lines);
  return lines.map(l=>({...l,header:(l.y<height*.12 || l.y>height*.9) && l.size<=body*1.15}));
}
