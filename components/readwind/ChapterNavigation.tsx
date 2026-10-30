"use client";
import {useState} from 'react';
import type {Book,Anchor} from '@/lib/readwind/types';
import {labelAt,sectionStart,compare} from '@/lib/readwind/anchors';

export function ChapterNavigation({book,currentSection,onSelect}:{book:Book;currentSection:number;onSelect:(section:number,at?:Anchor,pageIndex?:number)=>void}) {
  const [query,setQuery]=useState('');
  const entries=book.sections.map((section,index)=>{const at=sectionStart(book,index),mark=[...book.pageMarks].reverse().find(m=>compare(m.at,at)<=0);return {section,index,at,pageIndex:mark?.index||0};});
  for(const entry of book.navigation||[]){
    if(entries.some(e=>e.pageIndex===entry.pageIndex && e.section.title===entry.title))continue;
    const mark=book.pageMarks.find(m=>m.index===entry.pageIndex);if(!mark)continue;
    let at=mark.at;const end=book.pageMarks.find(m=>m.index===entry.pageIndex+1)?.at;
    for(let bi=at.block;bi<book.sections[at.section].blocks.length;bi++){
      if(end?.section===at.section && bi>end.block)break;
      const b=book.sections[at.section].blocks[bi];if(b.type==='figure')continue;
      const offset=b.text.indexOf(entry.title);if(offset<0 || bi===mark.at.block && offset<mark.at.offset || end?.section===at.section && bi===end.block && offset>=end.offset)continue;
      at={section:at.section,block:bi,offset};break;
    }
    entries.push({section:{...book.sections[at.section],title:entry.title,level:entry.level},index:at.section,at,pageIndex:entry.pageIndex});
  }
  const visible=entries.sort((a,b)=>a.pageIndex-b.pageIndex || a.at.block-b.at.block || a.at.offset-b.at.offset).filter(({section})=>section.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <nav className="chapter-navigation" aria-label="Chapters">
    <input type="search" aria-label="Search chapters" placeholder="Find a chapter" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="contents-list">{visible.map(({section,index,at,pageIndex},n)=><button type="button" key={`${section.id}:${n}`} style={{paddingInlineStart:`${16+Math.min(6,section.level||0)*14}px`}} aria-current={currentSection===index && section.title===book.sections[index].title?'location':undefined} onClick={()=>onSelect(index,at,pageIndex)}><span>{section.title}</span><small>p. {book.pageMarks.find(m=>m.index===pageIndex)?.label || labelAt(book,at)}</small></button>)}</div>
    {!visible.length&&<p className="muted">No chapters match that name.</p>}
  </nav>;
}
