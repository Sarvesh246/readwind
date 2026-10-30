import {createRoot,type Root} from 'react-dom/client';
import {useEffect} from 'react';
import {useLibrary,type Library as LibraryData,type AuthClient} from '../../lib/readwind/useLibrary';
import {Library} from '../../components/readwind/Library';
let latest:LibraryData|undefined,root:Root|undefined;
const auth={} as AuthClient;
function Harness({owner}:{owner:string}){const library=useLibrary(owner,owner==='preview'?null:auth);useEffect(()=>{latest=library;},[library]);return <Library library={library} navigate={()=>{}} onFile={()=>{}} onAccount={()=>{}}/>;}
export function mount(owner:string){if(!root){const element=document.createElement('div');element.id='deletion-harness';document.body.appendChild(element);root=createRoot(element);}root.render(<Harness owner={owner}/>);}
export function unmount(){root?.unmount();document.querySelector('#deletion-harness')?.remove();root=undefined;latest=undefined;}
export function current(){return latest;}
