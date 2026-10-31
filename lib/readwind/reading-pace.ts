export type PaceEntry = { samples:number; words:number; seconds:number };
export type ReadingPace = Record<string, PaceEntry>;
export function mergeReadingPace(a:ReadingPace = {}, b:ReadingPace = {}):ReadingPace {
  const merged={...a};
  for(const [id,entry] of Object.entries(b)) if(!merged[id] || entry.samples>merged[id].samples) merged[id]=entry;
  return merged;
}
export function readingSpeed(pace:ReadingPace = {}) {
  let words=460, seconds=120; // A modest prior stabilizes the first few page turns.
  for(const entry of Object.values(pace)){words+=entry.words;seconds+=entry.seconds;}
  return Math.max(50,Math.min(700,words*60/seconds));
}
export function validPaceSample(words:number, seconds:number) {
  const speed=words*60/seconds;
  return Number.isFinite(words) && Number.isFinite(seconds) && words>=20 && words<=1600 && seconds>=8 && seconds<=180 && speed>=50 && speed<=700;
}
export function addPaceSample(pace:ReadingPace, id:string, words:number, seconds:number):ReadingPace {
  if(!validPaceSample(words,seconds)) return pace;
  const old=pace[id] || {samples:0,words:0,seconds:0};
  // Once a device has a real baseline, skimming bursts and long pauses are anomalies, not a new pace.
  if(old.samples>=5 && old.seconds>=900){
    const usual=old.words*60/old.seconds, speed=words*60/seconds;
    if(speed>usual*2.5 || speed<usual*0.35) return pace;
  }
  const weight=old.seconds>0?Math.min(1,Math.max(0,7200-seconds)/old.seconds):1;
  return {...pace,[id]:{samples:old.samples+1,words:old.words*weight+words,seconds:old.seconds*weight+seconds}};
}

/** A reader-local baseline; never infer reading time from a saved position's age. */
export class PaceTracker {
  private baseline?:{words:number;time:number};
  reset(){this.baseline=undefined;}
  observe(words:number,time:number) {
    const before=this.baseline;
    if(!before){this.baseline={words,time};return;}
    const delta=words-before.words, seconds=(time-before.time)/1000;
    if(delta===0 && seconds<=180) return;
    if(delta>0 && delta<20 && seconds<=180) return;
    this.baseline={words,time};
    if(validPaceSample(delta,seconds)) return {words:delta,seconds};
  }
}
