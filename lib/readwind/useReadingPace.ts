"use client";
import {useEffect,useRef} from 'react';
import {PaceTracker} from './reading-pace';
import {ActivityTracker} from './reading-log';
import type {LogEntry} from './reading-log';

export function useReadingPace(bookId:string, words:number, enabled:boolean, record:(words:number,seconds:number)=>Promise<void>, recordActivity?:(credit:LogEntry)=>Promise<void>) {
  const tracker=useRef(new PaceTracker()),activity=useRef(new ActivityTracker());
  useEffect(()=>{
    const reset=()=>{tracker.current.reset();activity.current.reset();};
    document.addEventListener('visibilitychange',reset);
    window.addEventListener('blur',reset);
    window.addEventListener('focus',reset);
    return()=>{document.removeEventListener('visibilitychange',reset);window.removeEventListener('blur',reset);window.removeEventListener('focus',reset);};
  },[]);
  useEffect(()=>{tracker.current.reset();activity.current.reset();},[bookId]);
  useEffect(()=>{
    if(!enabled || document.hidden || !document.hasFocus()){tracker.current.reset();activity.current.reset();return;}
    const now=performance.now();
    const sample=tracker.current.observe(words,now);
    if(sample) void record(sample.words,sample.seconds).catch(()=>{});
    const credit=activity.current.observe(words,now);
    if(credit && recordActivity) void recordActivity(credit).catch(()=>{});
  },[words,enabled,record,recordActivity]);
}
