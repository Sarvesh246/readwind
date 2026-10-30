"use client";
import {useEffect,useLayoutEffect,useRef} from 'react';

const useBrowserLayoutEffect=typeof window==='undefined'?useEffect:useLayoutEffect;

/** Fit the actual font and card width, retaining every word and a readable minimum. */
export function ResponsiveBookTitle({text}:{text:string}){
 const ref=useRef<HTMLHeadingElement>(null);
 useBrowserLayoutEffect(()=>{
  const title=ref.current,parent=title?.parentElement;if(!title || !parent)return;
  let frame=0,alive=true,width=parent.clientWidth;
  const fit=()=>{
   if(!alive || !title.clientWidth)return;
   title.style.fontSize='';title.style.overflowWrap='normal';
   const css=getComputedStyle(title),max=parseFloat(css.fontSize),min=Math.min(18,max),leading=parseFloat(css.lineHeight)/max;
   const fits=(size:number)=>{
    title.style.fontSize=`${size}px`;
    return title.scrollWidth<=title.clientWidth && title.scrollHeight<=size*leading*4+1;
   };
   let low=min,high=max,best=min;
   for(let i=0;i<14;i++){const size=(low+high)/2;if(fits(size)){best=size;low=size;}else high=size;}
   title.style.fontSize=`${best}px`;
   // Very long titles may use more lines at the minimum; never clip the text.
   // Only a word that cannot fit even at that size gets an emergency break.
   title.style.overflowWrap=title.scrollWidth>title.clientWidth?'anywhere':'normal';
  };
  const schedule=()=>{if(!alive)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(fit);};
  fit();void document.fonts.ready.then(schedule);document.fonts.addEventListener('loadingdone',schedule);
  const observer=new ResizeObserver(()=>{if(parent.clientWidth!==width){width=parent.clientWidth;schedule();}});observer.observe(parent);
  return ()=>{alive=false;cancelAnimationFrame(frame);observer.disconnect();document.fonts.removeEventListener('loadingdone',schedule);};
 },[text]);
 return <h1 ref={ref} className="responsive-book-title">{text}</h1>;
}
