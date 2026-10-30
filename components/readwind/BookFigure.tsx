"use client";
import {useState} from 'react';
import {BlobImage} from './BlobImage';
import {Modal} from './Modal';
export function BookFigure({id,loadBlob,sourcePageIndex,onSourcePage}:{id:string;loadBlob:(id:string)=>Promise<Blob|undefined>;sourcePageIndex?:number;onSourcePage?:(index:number)=>void}){
 const [open,setOpen]=useState(false);
 return <><button type="button" className="book-figure-open" aria-label="Enlarge illustration or table" title="Enlarge illustration or table" onClick={e=>{e.stopPropagation();setOpen(true);}}><BlobImage id={id} loadBlob={loadBlob} alt="Book illustration or table"/></button>
 {open&&<Modal title="Illustration or table" className="figure-modal" onClose={()=>setOpen(false)}><BlobImage id={id} loadBlob={loadBlob} alt="Enlarged book illustration or table" className="figure-enlarged"/>{sourcePageIndex!==undefined && onSourcePage && <button type="button" className="button" onClick={()=>{setOpen(false);onSourcePage(sourcePageIndex);}}>View original page</button>}</Modal>}</>;
}
