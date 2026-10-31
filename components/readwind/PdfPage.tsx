"use client";
import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy,RenderTask,TextLayer} from 'pdfjs-dist';
import type {Annotation} from '@/lib/readwind/types';
import {colors} from '@/lib/readwind/types';
export function PdfPage({pdf,index,width,annotations=[],onEdit,onNavigatePage}:{pdf:PDFDocumentProxy;index:number;width:number;annotations?:Annotation[];onEdit?:(a:Annotation)=>void;onNavigatePage?:(index:number)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null);
 const [height,setHeight]=useState(width*1.414),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 const [links,setLinks]=useState<{index:number;x:number;y:number;width:number;height:number}[]>([]);
 useEffect(()=>{
  let alive=true,render:RenderTask|undefined,layer:TextLayer|undefined;const container=text.current!;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset page state when the document, page or width changes
  setBusy(true);setError('');setLinks([]);
  (async()=>{
   const page=await pdf.getPage(index+1);if(!alive)return;
   const base=page.getViewport({scale:1}),scale=width/base.width,v=page.getViewport({scale});
   setHeight(v.height);
   const c=canvas.current!;
   const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(12_000_000/(v.width*v.height)),4096/Math.max(v.width,v.height));
   c.width=Math.ceil(v.width*ratio);c.height=Math.ceil(v.height*ratio);
   container.replaceChildren();container.style.setProperty('--total-scale-factor',String(scale));
   render=page.render({canvas:c,canvasContext:c.getContext('2d')!,viewport:v,transform:[ratio,0,0,ratio,0,0],background:'rgb(255,255,255)'});
   await render.promise;if(!alive)return;
   setBusy(false);
   const targets=[];
   for(const annotation of await page.getAnnotations().catch(()=>[])){
    try{
     const dest=typeof annotation.dest==='string'?await pdf.getDestination(annotation.dest):annotation.dest;
     if(!Array.isArray(dest)||!annotation.rect)continue;
     const target=typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0]);
     if(target<0||target>=pdf.numPages)continue;
     const a=v.convertToViewportPoint(annotation.rect[0],annotation.rect[1]),b=v.convertToViewportPoint(annotation.rect[2],annotation.rect[3]);
     targets.push({index:target,x:Math.min(a[0],b[0])/v.width,y:Math.min(a[1],b[1])/v.height,width:Math.abs(a[0]-b[0])/v.width,height:Math.abs(a[1]-b[1])/v.height});
    }catch{/* Ignore malformed PDF links. */}
   }
   if(!alive)return;setLinks(targets);
   // A damaged text map must never prevent the original page from displaying.
   const content=await page.getTextContent();if(!alive)return;
   const {TextLayer}=await import('pdfjs-dist');if(!alive)return;
   layer=new TextLayer({textContentSource:content,container,viewport:v});await layer.render();
  })().catch(e=>{if(alive&&e.name!=='RenderingCancelledException'){setBusy(false);setError(e.message||'This page could not be displayed.');}});
  return ()=>{alive=false;render?.cancel();layer?.cancel();container.replaceChildren();};
 },[pdf,index,width]);
 return <div className="pdf-sheet" data-pdf-page={index} style={{width,height}}>
  <canvas ref={canvas} role="img" aria-label={`Original PDF page ${index+1}`} style={{width:'100%',height:'100%'}}/>
  <div ref={text} className="readwind-pdf-text"/>
  {onNavigatePage&&links.map((link,i)=><button type="button" key={i} className="pdf-internal-link" aria-label={`Go to PDF page ${link.index+1}`} onClick={()=>onNavigatePage(link.index)} style={{left:`${link.x*100}%`,top:`${link.y*100}%`,width:`${link.width*100}%`,height:`${link.height*100}%`}}/>)}
  {annotations.filter(a=>!a.deleted&&a.pdfRange?.pageIndex===index).map(a=>a.pdfRange!.rects.map((r,i)=><button key={`${a.id}-${i}`} className="pdf-highlight" aria-label={`Edit highlight: ${a.quote}`} onClick={()=>onEdit?.(a)} style={{left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.width*100}%`,height:`${r.height*100}%`,background:colors[a.color]}}/>))}
  {busy&&<div className="pdf-page-status" role="status">Opening page {index+1}…</div>}
  {error&&<p className="pdf-page-error" role="alert">{error}</p>}
 </div>;
}
