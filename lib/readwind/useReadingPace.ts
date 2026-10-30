"use client";
import {useEffect,useRef} from 'react';
import {PaceTracker} from './reading-pace';

export function useReadingPace(bookId:string, words:number, enabled:boolean, record:(words:number,seconds:number)=>Promise<void>) {
  const tracker=useRef(new PaceTracker());
  useEffect(()=>{
    const reset=()=>tracker.current.reset();
    document.addEventListener('visibilitychange',reset);
    window.addEventListener('blur',reset);
    window.addEventListener('focus',reset);
    return()=>{document.removeEventListener('visibilitychange',reset);window.removeEventListener('blur',reset);window.removeEventListener('focus',reset);};
  },[]);
  useEffect(()=>{tracker.current.reset();},[bookId]);
  useEffect(()=>{
    if(!enabled || document.hidden || !document.hasFocus()){tracker.current.reset();return;}
    const sample=tracker.current.observe(words,performance.now());
    if(sample) void record(sample.words,sample.seconds).catch(()=>{});
  },[words,enabled,record]);
}
