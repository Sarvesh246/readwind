"use client";
import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy,RenderTask,TextLayer} from 'pdfjs-dist';
import type {Annotation} from '@/lib/readwind/types';
import {colors} from '@/lib/readwind/types';
export function PdfPage({pdf,index,width,annotations=[],onEdit}:{pdf:PDFDocumentProxy;index:number;width:number;annotations?:Annotation[];onEdit?:(a:Annotation)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null);
 const [height,setHeight]=useState(width*1.414),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 useEffect(()=>{
  let alive=true,render:RenderTask|undefined,layer:TextLayer|undefined;
  setBusy(true);setError('');
  (async()=>{
   const page=await pdf.getPage(index+1);if(!alive)return;
   const base=page.getViewport({scale:1}),scale=width/base.width,v=page.getViewport({scale});
   setHeight(v.height);
   const c=canvas.current!,container=text.current!;
   const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(12_000_000/(v.width*v.height)),4096/Math.max(v.width,v.height));
   c.width=Math.ceil(v.width*ratio);c.height=Math.ceil(v.height*ratio);
   container.replaceChildren();container.style.setProperty('--total-scale-factor',String(scale));
   render=page.render({canvas:c,canvasContext:c.getContext('2d')!,viewport:v,transform:[ratio,0,0,ratio,0,0],background:'rgb(255,255,255)'});
   await render.promise;if(!alive)return;
   setBusy(false);
   // A damaged text map must never prevent the original page from displaying.
   const content=await page.getTextContent();if(!alive)return;
   const {TextLayer}=await import('pdfjs-dist');if(!alive)return;
   layer=new TextLayer({textContentSource:content,container,viewport:v});await layer.render();
  })().catch(e=>{if(alive&&e.name!=='RenderingCancelledException'){setBusy(false);setError(e.message||'This page could not be displayed.');}});
  return ()=>{alive=false;render?.cancel();layer?.cancel();text.current?.replaceChildren();};
 },[pdf,index,width]);
 return <div className="pdf-sheet" data-pdf-page={index} style={{width,height}}>
  <canvas ref={canvas} role="img" aria-label={`Original PDF page ${index+1}`} style={{width:'100%',height:'100%'}}/>
  <div ref={text} className="readwind-pdf-text"/>
  {annotations.filter(a=>!a.deleted&&a.pdfRange?.pageIndex===index).map(a=>a.pdfRange!.rects.map((r,i)=><button key={`${a.id}-${i}`} className="pdf-highlight" aria-label={`Edit highlight: ${a.quote}`} onClick={()=>onEdit?.(a)} style={{left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.width*100}%`,height:`${r.height*100}%`,background:colors[a.color]}}/>))}
  {busy&&<div className="pdf-page-status" role="status">Opening page {index+1}…</div>}
  {error&&<p className="pdf-page-error" role="alert">{error}</p>}
 </div>;
}
