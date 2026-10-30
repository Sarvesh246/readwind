import type {ReactNode} from 'react';
import type {Anchor,Book} from '@/lib/readwind/types';
import type {Fragment} from '@/lib/readwind/pagination';
import {contentsRanges} from '@/lib/readwind/reading-layout';
import {ContentsEntry} from './ContentsEntry';

export function ContentsText({book,fragment,onNavigate,render}:{book:Book;fragment:Fragment;onNavigate?:(at:Anchor)=>void;render:(fragment:Fragment)=>ReactNode}) {
  const entries=contentsRanges(book,fragment.section,fragment.block);
  if(!entries)return <>{render(fragment)}</>;
  return <>{entries.map((entry,i)=>{
    const start=Math.max(entry.start,fragment.start),end=Math.min(entry.end,fragment.end);
    if(end<=start)return null;
    return <span className="reading-contents-row" key={i}><ContentsEntry book={book} pageIndex={entry.pageIndex} onNavigate={onNavigate}>{render({...fragment,start,end,drop:false,text:book.sections[fragment.section].blocks[fragment.block].text!.slice(start,end)})}</ContentsEntry></span>;
  })}</>;
}
