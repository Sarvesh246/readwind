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
 const pct=(used:number,total:number)=>total>0?Math.min(100,Math.max(used>0?2:0,used/total*100)):0;
 return <details className="settings-details"><summary>Storage and account access</summary><div className="panel-body">
 {usage&&<div className="meter-block"><div className="meter-head"><span>Private cloud files</span><strong>{mb(usage.bytes)} of {mb(usage.limit)}</strong></div><div className="meter" aria-hidden="true"><span style={{width:`${pct(usage.bytes,usage.limit)}%`}}/></div><small>Stored with {usage.provider}</small></div>}
 {device&&<div className="meter-block"><div className="meter-head"><span>Browser storage</span><strong>{mb(device.usage || 0)} of ~{mb(device.quota || 0)}</strong></div><div className="meter" aria-hidden="true"><span style={{width:`${pct(device.usage||0,device.quota||0)}%`}}/></div><small>The browser may evict unprotected downloads.</small></div>}
 {downloads.length>0&&<div className="panel-section"><h3>Downloaded books</h3><ul className="row-list">{downloads.map(book=><li key={book.id}><div className="row-text"><strong>{book.title}</strong><small>{mb(book.bytes)} · {book.complete?'Available offline':'Download incomplete'}</small></div><button className="button small" disabled={busy} onClick={()=>void remove(book.id)}>Remove download</button></li>)}</ul></div>}
 {usage&&<div className="panel-section"><h3>Signed-in sessions</h3><small>Revoking cloud access does not remotely erase offline downloads.</small><ul className="row-list">{usage.sessions.map(session=><li key={session.id}><div className="row-text"><strong>{session.current?'This session':'Other session'}</strong><small>Refreshed {new Date(session.lastUsed).toLocaleDateString()} · expires {new Date(session.expiresAt).toLocaleDateString()}</small></div>{!session.current&&<button className="button small" disabled={busy} onClick={()=>void revoke(session.id)}>Revoke</button>}</li>)}</ul><button className="button" disabled={busy} onClick={()=>void revoke()}>Revoke other sessions</button></div>}
 <div className="panel-section danger-zone"><h3>Delete account</h3><small>Export a backup first. Deletion removes private cloud data and this device’s downloads; shared catalog books stay available to other readers.</small><button className="button danger" disabled={busy} onClick={()=>void deleteAccount()}>Delete account permanently</button></div>
 {message&&<p role="status" className="panel-message">{message}</p>}
 </div></details>;
}
