"use client";
import {useEffect,useState} from 'react';
import type {Library} from '@/lib/readwind/useLibrary';
import {boundedFetch} from '@/lib/readwind/sync-safety';
import {bookAssets} from '@/lib/readwind/catalog';
import {storedBlob} from '@/lib/readwind/db';
type Usage={deletionPending?:boolean;bytes:number;limit:number;provider:string;sessions:{id:string;current:boolean;expiresAt:string;lastUsed:string}[]};
const mb=(bytes:number)=>(bytes/1024/1024).toFixed(1)+' MiB';
export function AccountStorage({library:l,onDeleted}:{library:Library;onDeleted:()=>void}){
 const [usage,setUsage]=useState<Usage|null>(null),[device,setDevice]=useState<StorageEstimate|null>(null),[downloads,setDownloads]=useState<{id:string;title:string;bytes:number;complete:boolean}[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let alive=true;void (async()=>{
  const estimate=await navigator.storage?.estimate();if(alive)setDevice(estimate || null);
  const values=[];
  for(const book of l.books){let bytes=0,complete=true;for(const id of bookAssets(book)){const file=await l.db.blobs.get(id);if(file)bytes+=storedBlob(file).size;else complete=false;}values.push({id:book.id,title:book.title,bytes,complete});}
  if(alive)setDownloads(values);
  if(navigator.onLine){const response=await boundedFetch('/api/account');if(response.ok && alive)setUsage(await response.json() as Usage);}
 })().catch(()=>{});return()=>{alive=false;};},[l.db,l.books,refresh]);
 async function revoke(id?:string){setBusy(true);try{const response=await boundedFetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revoke',id})});if(!response.ok)throw new Error('Could not revoke the session.');setMessage('Session access revoked. Offline copies on those devices remain until they reconnect or are cleared.');setRefresh(n=>n+1);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 async function remove(id:string){try{await l.removeDownload(id);setRefresh(n=>n+1);}catch(e){setMessage((e as Error).message);}}
 async function deleteAccount(){
  if(!window.confirm('Delete this account, private books, notes, statistics and recovery archives permanently? Shared catalog editions stay available. Export a backup first. Offline devices may retain downloaded copies until cleared.'))return;
  const confirmation=window.prompt('Type DELETE to confirm permanent account deletion.');if(confirmation!=='DELETE')return;
  const password=window.prompt('Enter your account password to authorize deletion.');if(!password)return;
  setBusy(true);try{
   if(!usage?.deletionPending && !await l.prepareSignOut())throw new Error('Sync pending changes and resolve conflicts before deleting your account.');
   let pending=true;
   while(pending){const response=await boundedFetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',confirmation,password})});const data=await response.json() as {error?:string;pending?:boolean;remaining?:number};if(!response.ok)throw new Error(data.error || 'Deletion paused. Retry to continue.');pending=!!data.pending;if(pending)setMessage(`Deleting private files: ${data.remaining} remain.`);}
   await l.db.delete();localStorage.removeItem('folio-offline-user');sessionStorage.removeItem('folio-offline-user');localStorage.removeItem('readwind-offline-enabled');
   const {default:Dexie}=await import('dexie');await Dexie.delete(`readwind-recovery-${l.paceOwner}`);
   onDeleted();
  }catch(e){setMessage((e as Error).message);l.resumeEditing();}finally{setBusy(false);}
 }
 return <details><summary>Storage and account access</summary>
 {usage&&<p>Private cloud files: {mb(usage.bytes)} of {mb(usage.limit)} · {usage.provider}</p>}
 {device&&<p>Browser storage: {mb(device.usage || 0)} used of approximately {mb(device.quota || 0)}. The browser may evict unprotected downloads.</p>}
 <ul>{downloads.map(book=><li key={book.id}>{book.title}: {mb(book.bytes)} · {book.complete?'Available offline':'Download incomplete'} <button className="button small" disabled={busy} onClick={()=>void remove(book.id)}>Remove download</button></li>)}</ul>
 {usage&&<><h3>Signed-in sessions</h3><p>Revoking cloud access does not remotely erase offline downloads.</p>{usage.sessions.map(session=><p key={session.id}>{session.current?'This session':'Other session'} · last refreshed {new Date(session.lastUsed).toLocaleDateString()} · expires {new Date(session.expiresAt).toLocaleDateString()} {!session.current&&<button className="button" disabled={busy} onClick={()=>void revoke(session.id)}>Revoke</button>}</p>)}<button className="button" disabled={busy} onClick={()=>void revoke()}>Revoke other sessions</button></>}
 <p>Export a backup before deleting your account. Deletion removes private cloud data and this device’s downloads; shared catalog books stay available to other readers.</p><button className="button" disabled={busy} onClick={()=>void deleteAccount()}>Delete account permanently</button>
 {message&&<p role="status">{message}</p>}
 </details>;
}
