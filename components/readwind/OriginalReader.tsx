"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {Book,Annotation,Color} from '@/lib/readwind/types';
import {themes} from '@/lib/readwind/types';
import {compare,start,wordProgress} from '@/lib/readwind/anchors';
import type {Library} from '@/lib/readwind/useLibrary';
import {PdfPage} from './PdfPage';
import {Icon} from './Icon';
import {SelectionToolbar} from './SelectionToolbar';
import {Modal} from './Modal';
import {Comfort} from './Comfort';
export function OriginalReader({book,library:l,navigate}:{book:Book;library:Library;navigate:(u:string)=>void}){
 const [comfort,setComfort]=useState(false),[full,setFull]=useState(false);
 const saved=l.progress.find(p=>p.bookId===book.id);
 const initial=Math.max(0,...book.pageMarks.filter(m=>compare(m.at,saved?.at||start)<=0).map(m=>m.index));
 const [index,setIndex]=useState(initial),[pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[password,setPassword]=useState(''),[unlock,setUnlock]=useState<((s:string)=>void)|null>(null),[passwordMessage,setPasswordMessage]=useState(''),[url,setUrl]=useState(''),[width,setWidth]=useState(800),[zoom,setZoom]=useState(1),[contents,setContents]=useState(false),[go,setGo]=useState('');
 const [selection,setSelection]=useState<Annotation|null>(null),[note,setNote]=useState(''),[point,setPoint]=useState<{x:number;y:number}|null>(null);
 const navigated=useRef(false);
 const area=useRef<HTMLDivElement>(null),navRef=useRef<(n:number)=>void>(()=>{}),selectionRef=useRef(selection);selectionRef.current=selection;
 const annotations=l.annotations.filter(a=>a.bookId===book.id&&!a.deleted),theme=themes[l.settings.paper];
 const spread=width>850&&l.settings.wideLayout==='spread'&&zoom===1;
 const pageWidth=Math.max(240,(width-(spread?72:36))/(spread?2:1))*zoom;
 useEffect(()=>{const update=()=>setFull(!!document.fullscreenElement);document.addEventListener('fullscreenchange',update);return()=>document.removeEventListener('fullscreenchange',update);},[]);
 const fullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setFull(v=>!v);}};
 useEffect(()=>{if(saved&&(!navigated.current||saved.deviceId!==localStorage.getItem('folio-device'))&&!l.conflict){setIndex(Math.max(0,...book.pageMarks.filter(m=>compare(m.at,saved.at)<=0).map(m=>m.index)));}},[saved?.updatedAt,saved?.revision,l.conflict]);
 const at=(n:number)=>book.pageMarks.find(m=>m.index===n)?.at||start;
 const goto=(n:number)=>{navigated.current=true;n=Math.max(0,Math.min(book.printPageCount-1,n));setIndex(n);setSelection(null);area.current?.scrollTo(0,0);void l.saveProgress(book.id,at(n),wordProgress(book,at(n)).before);};navRef.current=goto;
 useEffect(()=>{const el=area.current!;const o=new ResizeObserver(([e])=>setWidth(e.contentRect.width));o.observe(el);return()=>o.disconnect();},[]);
 useEffect(()=>{
  let alive=true,task:ReturnType<(typeof import('pdfjs-dist'))['getDocument']>|undefined,objectUrl='';setError('');setPdf(null);
  (async()=>{
   const blob=await l.loadBlob(book.sourcePdfBlobId!);if(!blob)throw new Error('The original PDF is missing.');if(!alive)return;
   objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);
   const js=await import('pdfjs-dist');if(!alive)return;js.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
   task=js.getDocument({data:await blob.arrayBuffer(),cMapUrl:'/cmaps/',cMapPacked:true,standardFontDataUrl:'/standard_fonts/',wasmUrl:'/pdf-wasm/'});
   task.onPassword=(update:(s:string)=>void,reason:number)=>{if(alive){setPassword('');setPasswordMessage(reason===2?'That password was incorrect. Try again.':'This PDF needs its password on this device.');setUnlock(()=>update);}};
   const doc=await task.promise;if(alive){setUnlock(null);setPdf(doc);}
  })().catch(e=>{if(alive)setError(e.message||'Could not open this PDF.');});
  return()=>{alive=false;void task?.destroy();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[book.sourcePdfBlobId,l.loadBlob,retry]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.target as HTMLElement).closest('input,textarea,button,select')||selectionRef.current||window.getSelection()?.toString())return;if(['ArrowRight','PageDown'].includes(e.key)){e.preventDefault();navRef.current(index+(spread?2:1));}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();navRef.current(index-(spread?2:1));}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[index,spread]);
 function select(){
  const s=window.getSelection();if(!s||s.isCollapsed||!s.rangeCount||!s.toString().trim())return;
  const range=s.getRangeAt(0),node=range.startContainer.parentElement?.closest<HTMLElement>('[data-pdf-page]'),end=range.endContainer.parentElement?.closest('[data-pdf-page]');
  if(!node||node!==end)return;
  const pageIndex=Number(node.dataset.pdfPage),box=node.getBoundingClientRect();
  const rects=Array.from(range.getClientRects()).filter(r=>r.width>0&&r.height>0).map(r=>{const x=Math.max(0,(r.left-box.left)/box.width),y=Math.max(0,(r.top-box.top)/box.height);return{x,y,width:Math.max(0,Math.min(1-x,r.width/box.width)),height:Math.max(0,Math.min(1-y,r.height/box.height))};}).slice(0,2000);
  if(!rects.length)return;const now=Date.now();setSelection({id:crypto.randomUUID(),bookId:book.id,kind:'highlight',range:{start:at(pageIndex),end:at(pageIndex)},quote:s.toString().trim(),note:'',color:'yellow',createdAt:now,updatedAt:now,pdfRange:{pageIndex,rects}});setNote('');setPoint({x:box.left+box.width/2,y:Math.min(window.innerHeight-240,Math.max(70,range.getBoundingClientRect().bottom+12))});
 }
 function save(color:Color,text=note){if(!selection)return;const a={...selection,color,note:text};void l.saveAnnotation(a);setSelection(null);window.getSelection()?.removeAllRanges();}
 const bookmarked=annotations.find(a=>a.kind==='bookmark'&&compare(a.range.start,at(index))===0);
 return <div className={`reader-shell original-reader ${full?"original-full":""}`} style={{'--desk':theme.desk,'--page':theme.page,'--ink':theme.ink,'--muted':theme.muted,'--edge':theme.edge,'--chip':theme.chip,'--reader-accent':theme.accent,'--reader-ink':theme.ink,'--reader-page':theme.page,'--reader-desk':theme.desk,'--reader-chip':theme.chip} as CSSProperties}>
 <header className="reader-header"><button className="icon-button" aria-label="Back to library" onClick={()=>navigate('/')}><Icon name="back"/></button><div className="reader-title">{book.title}<small>Original layout</small></div><button className="button small" onClick={()=>void l.saveReadingMode(book,'reflow')}>Adjustable text</button><nav aria-label="Reader tools"><button className="icon-button aa" aria-label="Type and comfort settings" onClick={()=>setComfort(true)}>Aa</button><button className="icon-button" aria-label={full?"Exit full screen":"Full screen"} onClick={fullscreen}><Icon name="full"/></button><button className="icon-button" aria-label="Contents and go to page" onClick={()=>setContents(true)}><Icon name="contents"/></button><button className="icon-button" aria-label="Notebook" onClick={()=>navigate(`/book/${book.id}/notebook`)}><Icon name="notebook"/></button><button className="icon-button" aria-label={bookmarked?'Remove bookmark':'Bookmark page'} aria-pressed={!!bookmarked} onClick={()=>{const now=Date.now();void l.saveAnnotation(bookmarked?{...bookmarked,deleted:true}:{id:crypto.randomUUID(),bookId:book.id,kind:'bookmark',range:{start:at(index),end:at(index)},quote:`Page ${book.pageMarks.find(m=>m.index===index)?.label||index+1}`,note:'',color:'yellow',createdAt:now,updatedAt:now});}}><Icon name="bookmark"/></button></nav></header>
 <div className="pdf-controls"><button aria-label="Zoom out" disabled={zoom<=.75} onClick={()=>setZoom(z=>Math.max(.75,z-.25))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" disabled={zoom>=3} onClick={()=>setZoom(z=>Math.min(3,z+.25))}>+</button><button onClick={()=>setZoom(1)}>Fit</button>{width>850&&<button aria-pressed={l.settings.wideLayout==='spread'} onClick={()=>void l.saveSettings({...l.settings,wideLayout:l.settings.wideLayout==='spread'?'single':'spread'})}>Two pages</button>}{url&&<a href={url} download={`${book.title}.pdf`}>Download PDF</a>}</div>
 <main ref={area} className="pdf-reading-area" onMouseUp={select} onKeyUp={select} onTouchEnd={()=>setTimeout(select,100)}>
 {error?<div className="pdf-state" role="alert"><p>{error}</p><button className="button" onClick={()=>setRetry(n=>n+1)}>Retry</button>{url&&<a href={url} download={`${book.title}.pdf`}>Download original</a>}</div>:unlock?<form className="pdf-state" onSubmit={e=>{e.preventDefault();unlock(password);setUnlock(null);setPassword('');}}><p>{passwordMessage}</p><label>PDF password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus required/></label><button className="button primary">Unlock PDF</button></form>:pdf?<div className={`pdf-pages ${spread?'pdf-spread':''}`} key={index}><PdfPage pdf={pdf} index={index} width={pageWidth} annotations={annotations} onEdit={a=>{setSelection(a);setNote(a.note);setPoint(null);}}/>{spread&&index+1<pdf.numPages&&<PdfPage pdf={pdf} index={index+1} width={pageWidth} annotations={annotations} onEdit={a=>{setSelection(a);setNote(a.note);setPoint(null);}}/>}</div>:<div className="pdf-state" role="status">Opening your original PDF…</div>}
 </main>
 <footer className="pdf-footer"><button className="button small" aria-label="Previous page" disabled={index===0} onClick={()=>goto(index-(spread?2:1))}><Icon name="back"/> Previous</button><span>Page {book.pageMarks.find(m=>m.index===index)?.label||index+1}{spread&&index+1<book.printPageCount?`–${book.pageMarks.find(m=>m.index===index+1)?.label||index+2}`:''} · {index+1} of {book.printPageCount}<small>{l.guest?'Saved on this device':l.status}</small></span><button className="button small" aria-label="Next page" disabled={index+(spread?2:1)>=book.printPageCount} onClick={()=>goto(index+(spread?2:1))}>Next <Icon name="next"/></button></footer>
 {comfort&&<Comfort settings={l.settings} onChange={s=>void l.saveSettings(s)} onClose={()=>setComfort(false)}/>}
 {contents&&<Modal title="Contents and pages" onClose={()=>setContents(false)}><form onSubmit={e=>{e.preventDefault();const n=Number(go);if(n>=1&&n<=book.printPageCount){goto(n-1);setContents(false);}}}><label>PDF page (1–{book.printPageCount})<input type="number" min="1" max={book.printPageCount} value={go} onChange={e=>setGo(e.target.value)} required/></label><button className="button">Go</button></form>{book.sections.map((s,i)=><button className="pdf-chapter" key={s.id} onClick={()=>{goto(book.pageMarks.find(m=>m.at.section===i)?.index||0);setContents(false);}}>{s.title}</button>)}{book.importReport?.warnings.map(w=><p className="muted" key={w}>{w}</p>)}</Modal>}
 {selection&&<SelectionToolbar quote={selection.quote} note={note} onNote={setNote} onColor={c=>save(c)} onDelete={annotations.some(a=>a.id===selection.id)?()=>{void l.saveAnnotation({...selection,deleted:true});setSelection(null);}:undefined} onClose={()=>{setSelection(null);window.getSelection()?.removeAllRanges();}} position={point} selectedColor={selection.color} onSearch={()=>window.open(`https://www.google.com/search?q=${encodeURIComponent(selection.quote)}`,'_blank','noopener')}/>}
 </div>;
}
