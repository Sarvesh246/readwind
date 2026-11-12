"use client";
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import type {Library} from '@/lib/readwind/useLibrary';
import {boundedFetch} from '@/lib/readwind/sync-safety';
import {bookAssets} from '@/lib/readwind/catalog';
import {storedBlob} from '@/lib/readwind/db';
type Usage={deletionPending?:boolean;bytes:number;limit:number;provider:string;sessions:{id:string;current:boolean;expiresAt:string;lastUsed:string}[]};
const mb=(bytes:number)=>(bytes/1024/1024).toFixed(1)+' MB';
const day=(value:string)=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'});
/** Storage, device and account sections of the profile page. */
export function AccountStorage({library:l,onDeleted,passwordForm,signOutRow}:{library:Library;onDeleted:()=>void;passwordForm?:ReactNode;signOutRow?:ReactNode}){
 const [usage,setUsage]=useState<Usage|null>(null),[device,setDevice]=useState<StorageEstimate|null>(null),[downloads,setDownloads]=useState<{id:string;title:string;bytes:number;complete:boolean}[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let alive=true;void (async()=>{
  const estimate=await navigator.storage?.estimate();if(alive)setDevice(estimate || null);
  const values=[];
  for(const book of l.books){let bytes=0,complete=true;for(const id of bookAssets(book)){const file=await l.db.blobs.get(id);if(file)bytes+=storedBlob(file).size;else complete=false;}values.push({id:book.id,title:book.title,bytes,complete});}
  if(alive)setDownloads(values);
  if(navigator.onLine){const response=await boundedFetch('/api/account');if(response.ok && alive)setUsage(await response.json() as Usage);}
 })().catch(()=>{});return()=>{alive=false;};},[l.db,l.books,refresh]);
 async function revoke(id?:string){setBusy(true);try{const response=await boundedFetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revoke',id})});if(!response.ok)throw new Error('We couldn’t sign that device out. Please try again.');setMessage('Signed out. Books already downloaded to those devices stay there until they reconnect or are cleared.');setRefresh(n=>n+1);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 async function remove(id:string){try{await l.removeDownload(id);setRefresh(n=>n+1);}catch(e){setMessage((e as Error).message);}}
 async function deleteAccount(){
  if(!window.confirm('Delete your account permanently? This removes your private books, notes, reading stats and backups. Books from the shared catalog stay available to other readers. Download a backup first if you want to keep anything. Devices that are offline may keep their downloaded copies until they reconnect.'))return;
  const confirmation=window.prompt('To confirm, type DELETE.');if(confirmation!=='DELETE')return;
  const password=window.prompt('Enter your password to finish deleting your account.');if(!password)return;
  setBusy(true);try{
   if(!usage?.deletionPending && !await l.prepareSignOut())throw new Error('Let your changes finish syncing and resolve any conflicts before deleting your account.');
   let pending=true;
   while(pending){const response=await boundedFetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',confirmation,password})});const data=await response.json() as {error?:string;pending?:boolean;remaining?:number};if(!response.ok)throw new Error(data.error || 'Deleting your account was interrupted. Please try again to continue.');pending=!!data.pending;if(pending)setMessage(`Deleting your files… ${data.remaining} left.`);}
   await l.db.delete();localStorage.removeItem('folio-offline-user');sessionStorage.removeItem('folio-offline-user');localStorage.removeItem('readwind-offline-enabled');
   const {default:Dexie}=await import('dexie');await Dexie.delete(`readwind-recovery-${l.paceOwner}`);
   onDeleted();
  }catch(e){setMessage((e as Error).message);l.resumeEditing();}finally{setBusy(false);}
 }
 const [filter,setFilter]=useState('');
 const shown=downloads.filter(book=>book.title.toLowerCase().includes(filter.trim().toLowerCase()));
 const pct=(used:number,total:number)=>total>0?Math.min(100,Math.max(used>0?2:0,used/total*100)):0;
 const offline=downloads.filter(book=>book.bytes>0||!book.complete);
 return <>
 <section className="profile-section" aria-labelledby="profile-storage"><h2 id="profile-storage">Storage</h2>
  <div className="profile-card">
   {usage&&<div className="profile-block meter-block"><div className="meter-head"><span>Cloud</span><strong>{mb(usage.bytes)} of {mb(usage.limit)}</strong></div><div className="meter" role="progressbar" aria-label="Cloud storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct(usage.bytes,usage.limit))}><span style={{width:`${pct(usage.bytes,usage.limit)}%`}}/></div><small>Your books and notes, kept safe so they follow you to every device.</small></div>}
   {device&&<div className="profile-block meter-block"><div className="meter-head"><span>This device</span><strong>{mb(device.usage || 0)} used</strong></div><div className="meter" role="progressbar" aria-label="Device storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct(device.usage||0,device.quota||0))}><span style={{width:`${pct(device.usage||0,device.quota||0)}%`}}/></div><small>Your browser may clear downloaded books if this device runs low on space.</small></div>}
   {offline.length>0&&<div className="profile-block"><h3 className="profile-subhead">Saved for offline reading <span>{offline.length}</span></h3>{offline.length>5&&<div className="list-tools"><input type="search" aria-label="Search saved books" placeholder="Search by title" value={filter} onChange={e=>setFilter(e.target.value)}/></div>}<ul className="row-list scroll">{shown.map(book=><li key={book.id}><div className="row-text"><strong>{book.title}</strong><small>{mb(book.bytes)} · {book.complete?'Ready offline':'Not fully downloaded'}</small></div><button className="button small" disabled={busy} onClick={()=>void remove(book.id)}>Remove</button></li>)}{shown.length===0&&<li className="row-empty">No books match that search.</li>}</ul></div>}
   {!usage&&!device&&offline.length===0&&<p className="profile-empty">Storage details will appear here once you’re online.</p>}
  </div>
 </section>
 <section className="profile-section" aria-labelledby="profile-security"><h2 id="profile-security">Security</h2>
  <div className="profile-card">
   {passwordForm}
   {usage&&<div className="profile-block"><h3 className="profile-subhead">Signed-in devices</h3><ul className="row-list">{usage.sessions.map(session=><li key={session.id}><div className="row-text"><strong>{session.current?'This device':'Another device'}</strong><small>Last active {day(session.lastUsed)} · stays signed in until {day(session.expiresAt)}</small></div>{!session.current&&<button className="button small" disabled={busy} onClick={()=>void revoke(session.id)}>Sign out</button>}</li>)}</ul>{usage.sessions.some(s=>!s.current)&&<button className="button" disabled={busy} onClick={()=>void revoke()}>Sign out of all other devices</button>}<small>Signing a device out stops it from syncing. It won’t erase books already downloaded there.</small></div>}
  </div>
 </section>
 <section className="profile-section" aria-labelledby="profile-account"><h2 id="profile-account">Account</h2>
  <div className="profile-card">
   {signOutRow}
   <div className="profile-row profile-stack danger-zone"><span className="row-text"><strong>Delete account</strong><small>Permanently removes your private books, notes and reading stats. Shared catalog books stay available to other readers. We recommend downloading a backup first.</small></span><button className="button danger" disabled={busy} onClick={()=>void deleteAccount()}>Delete my account</button></div>
  </div>
  {message&&<p role="status" className="panel-message">{message}</p>}
 </section>
 </>;
}
