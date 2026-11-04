"use client";
import {useEffect,useRef} from 'react';
import {PaceTracker} from './reading-pace';
import {ActivityTracker} from './reading-log';
import type {LogEntry} from './reading-log';

/** Longest silence that still counts as reading: three pages' worth of time, between 30 s and 3 min. */
export const idleLimitMs=(wpm:number,wordsPerPage=250)=>Math.max(30000,Math.min(180000,3*wordsPerPage*60000/Math.max(50,wpm)));
/** Page visibility plus recent input; window focus alone is unreliable on phones and split screens. */
export const isEngaged=(visible:boolean,focused:boolean,sinceInputMs:number,limitMs:number)=>visible&&(focused||sinceInputMs<=limitMs);

type Extras={bookId?:string;density?:number;calibrate?:(lnRatio:number)=>Promise<void>};
/** Reading stretch compared against its prediction once it is long enough to be meaningful. */
const CALIBRATION_WORDS=1200;
export function useReadingPace(bookKey:string, words:number, enabled:boolean, record:(words:number,seconds:number,bookId?:string)=>Promise<void>, recordActivity?:(credit:LogEntry)=>Promise<void>, wpm=230, extras:Extras={}) {
  const tracker=useRef(new PaceTracker()),activity=useRef(new ActivityTracker()),lastInput=useRef(0),speed=useRef(wpm),extra=useRef(extras),stretch=useRef({words:0,seconds:0,predicted:0});
  useEffect(()=>{speed.current=wpm;extra.current=extras;});
  useEffect(()=>{lastInput.current=performance.now();},[]);
  useEffect(()=>{
    const reset=()=>{tracker.current.reset();activity.current.reset();};
    const hidden=()=>{if(document.hidden)reset();};
    const input=()=>{lastInput.current=performance.now();};
    const events=['pointerdown','keydown','wheel','touchstart','scroll'] as const;
    for(const e of events)window.addEventListener(e,input,{capture:true,passive:true});
    document.addEventListener('visibilitychange',hidden);
    window.addEventListener('pagehide',reset);
    return()=>{for(const e of events)window.removeEventListener(e,input,{capture:true});document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',reset);};
  },[]);
  useEffect(()=>{tracker.current.reset();activity.current.reset(true);stretch.current={words:0,seconds:0,predicted:0};},[bookKey]);
  useEffect(()=>{
    const now=performance.now();
    if(!enabled || !isEngaged(!document.hidden,document.hasFocus(),now-lastInput.current,idleLimitMs(speed.current))){tracker.current.reset();activity.current.reset();return;}
    const sample=tracker.current.observe(words,now);
    if(sample) void record(sample.words*(extra.current.density||1),sample.seconds,extra.current.bookId).catch(()=>{});
    const credit=activity.current.observe(words,now,speed.current);
    if(credit && recordActivity) void recordActivity(credit).catch(()=>{});
    if(credit && credit.words>0 && extra.current.calibrate){
      const w=stretch.current;w.words+=credit.words;w.seconds+=credit.seconds;w.predicted+=credit.words*60/speed.current;
      if(w.words>=CALIBRATION_WORDS){const ratio=Math.log(w.seconds/w.predicted);stretch.current={words:0,seconds:0,predicted:0};void extra.current.calibrate(ratio).catch(()=>{});}
    }
  },[words,enabled,record,recordActivity]);
}
