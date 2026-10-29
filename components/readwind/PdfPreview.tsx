"use client";
import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {PdfPage} from './PdfPage';
export function PdfPreview({file,password,index}:{file:File;password:string;index:number}){
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[error,setError]=useState(''),[width,setWidth]=useState(400);const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{const o=new ResizeObserver(([e])=>setWidth(e.contentRect.width));o.observe(root.current!);return()=>o.disconnect();},[]);
 useEffect(()=>{let alive=true,task:ReturnType<(typeof import('pdfjs-dist'))['getDocument']>|undefined;setPdf(null);setError('');(async()=>{const js=await import('pdfjs-dist');if(!alive)return;js.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';task=js.getDocument({data:await file.arrayBuffer(),password,cMapUrl:'/cmaps/',cMapPacked:true,standardFontDataUrl:'/standard_fonts/',wasmUrl:'/pdf-wasm/'});const doc=await task.promise;if(alive)setPdf(doc);})().catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;void task?.destroy();};},[file,password]);
 return <div ref={root} className="original-preview">{pdf?<PdfPage pdf={pdf} index={index} width={width}/>:<p role="status">{error||'Opening original page…'}</p>}</div>;
}
