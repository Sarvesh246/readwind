"use client";
import {useLayoutEffect,useRef} from 'react';

export function ChapterTitleInput({title,label,onChange}:{title:string;label:string;onChange:(value:string)=>void}) {
  const ref=useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(()=>{
    const node=ref.current!;
    const resize=()=>{node.style.height='auto';node.style.height=`${node.scrollHeight+2}px`;};
    resize();let width=node.getBoundingClientRect().width;
    const observer=new ResizeObserver(([entry])=>{if(Math.abs(entry.contentRect.width-width)<1)return;width=entry.contentRect.width;resize();});
    observer.observe(node);return()=>observer.disconnect();
  },[title]);
  return <textarea ref={ref} className="chapter-title" rows={1} aria-label={label} value={title} onChange={e=>onChange(e.target.value)}/>;
}
