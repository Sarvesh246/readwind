import type {Anchor,Book} from '@/lib/readwind/types';
import {sectionStart} from '@/lib/readwind/anchors';
import type {ReactNode} from 'react';

export function ContentsEntry({book,pageIndex,onNavigate,children}:{book:Book;pageIndex?:number;onNavigate?:(at:Anchor)=>void;children:ReactNode}) {
  const mark=pageIndex===undefined?undefined:book.pageMarks.find(m=>m.index===pageIndex);
  const at=mark && mark.at.block===0 ? sectionStart(book,mark.at.section) : mark?.at;
  return at && onNavigate ? <button type="button" className="contents-entry-link" onClick={e=>{e.stopPropagation();onNavigate(at);}}>{children}</button> : <>{children}</>;
}
