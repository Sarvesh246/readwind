"use client";
import {useState} from 'react';
import type {Book} from '@/lib/readwind/types';
import {labelAt,sectionStart} from '@/lib/readwind/anchors';

export function ChapterNavigation({book,currentSection,onSelect}:{book:Book;currentSection:number;onSelect:(section:number)=>void}) {
  const [query,setQuery]=useState('');
  const entries=book.sections.map((section,index)=>({section,index})).filter(({section})=>section.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <nav className="chapter-navigation" aria-label="Chapters">
    <input type="search" aria-label="Search chapters" placeholder="Find a chapter" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="contents-list">{entries.map(({section,index})=><button type="button" key={section.id} aria-current={currentSection===index?'location':undefined} onClick={()=>onSelect(index)}><span>{section.title}</span><small>p. {book.pageMarks.find(m=>m.at.section===index)?.label || labelAt(book,sectionStart(book,index))}</small></button>)}</div>
    {!entries.length&&<p className="muted">No chapters match that name.</p>}
  </nav>;
}
