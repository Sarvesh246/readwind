"use client";
import type {Book} from '@/lib/readwind/types';
import type {Library} from '@/lib/readwind/useLibrary';
import {Reader} from './Reader';
import {OriginalReader} from './OriginalReader';
export function BookReader(props:{book:Book;library:Library;navigate:(url:string)=>void}){
 return props.book.sourcePdfBlobId&&props.book.readingMode!=='reflow'?<OriginalReader {...props}/>:<Reader {...props}/>;
}
