"use client";
import {useState} from 'react';
import {BlobImage} from './BlobImage';
import {Modal} from './Modal';
import {PdfSourceImage} from './PdfSourceImage';
export function BookFigure({id,loadBlob,sourcePageIndex,onSourcePage,sourcePdf,aspectRatio}:{id:string;loadBlob:(id:string)=>Promise<Blob|undefined>;sourcePageIndex?:number;onSourcePage?:(index:number)=>void;sourcePdf?:boolean;aspectRatio?:number}){
 const [open,setOpen]=useState(false),[zoom,setZoom]=useState(1);
 const content=(large=false)=>sourcePdf && sourcePageIndex!==undefined?<PdfSourceImage key={`${id}:${sourcePageIndex}`} id={id} pageIndex={sourcePageIndex} aspectRatio={aspectRatio} loadBlob={loadBlob} alt={large?'Enlarged book illustration or table':'Book illustration or table'} className={large?'figure-enlarged':undefined} large={large}/>:<BlobImage id={id} loadBlob={loadBlob} alt={large?'Enlarged book illustration or table':'Book illustration or table'} className={large?'figure-enlarged':undefined}/>;
 return <><button type="button" className="book-figure-open" aria-label="Enlarge illustration or table" title="Enlarge illustration or table" onClick={e=>{e.stopPropagation();setZoom(1);setOpen(true);}}>{content()}</button>
 {open&&<Modal title="Illustration or table" className="figure-modal" onClose={()=>setOpen(false)}><div className="figure-zoom" role="group" aria-label="Illustration zoom"><button type="button" className="button small" aria-label="Zoom illustration out" disabled={zoom===1} onClick={()=>setZoom(z=>Math.max(1,z-.5))}>−</button><output aria-live="polite">{Math.round(zoom*100)}%</output><button type="button" className="button small" aria-label="Zoom illustration in" disabled={zoom===4} onClick={()=>setZoom(z=>Math.min(4,z+.5))}>+</button><button type="button" className="button small" onClick={()=>setZoom(1)}>Fit</button></div><div className="figure-viewport" tabIndex={0} role="region" aria-label="Illustration viewport"><div style={{width:`${zoom*100}%`}}>{content(true)}</div></div>{sourcePageIndex!==undefined && onSourcePage && <button type="button" className="button" onClick={()=>{setOpen(false);onSourcePage(sourcePageIndex);}}>View original page</button>}</Modal>}</>;
}
