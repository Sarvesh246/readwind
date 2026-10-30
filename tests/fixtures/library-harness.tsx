import {createRoot, type Root} from 'react-dom/client';
import {useEffect} from 'react';
import {useLibrary, type Library, type AuthClient} from '../../lib/readwind/useLibrary';
let latest: Library | undefined;
let root: Root;
export function current(){return latest;}
export function mount(owner:string){
 const auth={} as AuthClient;
 function Harness(){const library=useLibrary(owner,auth);useEffect(()=>{latest=library;},[library]);return null;}
 const element=document.createElement('div');document.body.appendChild(element);
 root=createRoot(element);root.render(<Harness/>);
}
export function unmount(){root.unmount();latest=undefined;}
