"use client";
import {useEffect,useRef,useState} from 'react';

/** Render only nearby source pages; importing a textbook must not duplicate every page as a PNG. */
export function PdfSourceImage({id,pageIndex,loadBlob,alt,className,large=false,aspectRatio}:{id:string;pageIndex:number;loadBlob:(id:string)=>Promise<Blob|undefined>;alt:string;className?:string;large?:boolean;aspectRatio?:number}){
 const ref=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false),[url,setUrl]=useState(''),[error,setError]=useState(false);
 useEffect(()=>{
  const el=ref.current;if(!el)return;
  const observer=new IntersectionObserver(entries=>{const near=entries.some(e=>e.isIntersecting);setVisible(near);if(!near)setUrl('');},{rootMargin:'250px'});observer.observe(el);return ()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  if(!visible)return;
  let alive=true,url='',task:ReturnType<typeof import('pdfjs-dist')['getDocument']>|undefined;
  void(async()=>{
   try{
    const blob=await loadBlob(id);if(!alive)return;if(!blob)throw new Error('Source page is unavailable offline.');
    const pdfjs=await import('pdfjs-dist');if(!alive)return;pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
    const data=await blob.arrayBuffer();if(!alive)return;
    task=pdfjs.getDocument({data,cMapUrl:'/cmaps/',cMapPacked:true,standardFontDataUrl:'/standard_fonts/',wasmUrl:'/pdf-wasm/'});
    const pdf=await task.promise,page=await pdf.getPage(pageIndex+1),base=page.getViewport({scale:1});if(!alive)return;
    const scale=Math.min((large?2000:1200)/base.width,4096/Math.max(base.width,base.height),Math.sqrt(8_000_000/(base.width*base.height))),viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport}).promise;
    const image=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!alive || !image)return;
    url=URL.createObjectURL(image);setUrl(url);await task.destroy();
   }catch{if(alive)setError(true);}
  })();
  return ()=>{alive=false;if(url)URL.revokeObjectURL(url);void task?.destroy();};
 },[visible,id,pageIndex,loadBlob,large]);
 return <span ref={ref} style={{aspectRatio}} className={`source-page-image ${className||''}`}>{visible && url?<img src={url} alt={alt}/>:<span className="image-loading">{error?'Original page unavailable · connect to download':'Loading original page…'}</span>}</span>;
}
