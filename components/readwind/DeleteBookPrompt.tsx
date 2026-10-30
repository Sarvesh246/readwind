"use client";
import {useState,useRef,useEffect} from 'react';
import {Modal} from './Modal';
export function DeleteBookPrompt({title,onCancel,onDelete}:{title:string;onCancel:()=>void;onDelete:(dontAskAgain:boolean)=>void}){
 const [dontAsk,setDontAsk]=useState(false);
 const cancel=useRef<HTMLButtonElement>(null);useEffect(()=>cancel.current?.focus(),[]);
 return <Modal title="Delete book?" className="delete-book-prompt" onClose={onCancel}>
  <p>Delete <strong>{title}</strong> and its notes from your library?</p>
  <p className="muted">This also removes its saved reading position and downloaded files.</p>
  <label className="delete-confirm-choice"><input type="checkbox" checked={dontAsk} onChange={e=>setDontAsk(e.target.checked)}/>Don’t ask again</label>
  <div className="delete-confirm-actions"><button ref={cancel} type="button" className="button" autoFocus onClick={onCancel}>Cancel</button><button type="button" className="button delete-confirm-button" onClick={()=>onDelete(dontAsk)}>Delete book</button></div>
 </Modal>;
}
