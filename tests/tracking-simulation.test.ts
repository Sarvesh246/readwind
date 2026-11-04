import {describe,it,expect} from 'vitest';
import {addPaceSample,readingSpeed,readingSpeedRange,paceIsEstimating,PaceTracker,type ReadingPace} from '../lib/readwind/reading-pace';
import {ActivityTracker,addActivity,dailyTotals,qualifyingDays,streakOf,dayKey,mergeReadingLog,type ReadingLog} from '../lib/readwind/reading-log';
import {review,previewIntervals,retrievability,dueQueue,isLeech,memoryState,MAX_INTERVAL,type Review,type Grade} from '../lib/readwind/spaced-repetition';
import {StablePositions,shouldPromptContinue} from '../lib/readwind/position';
import {idleLimitMs,isEngaged} from '../lib/readwind/useReadingPace';

/** Deterministic noise so simulations are reproducible. */
const rng=(seed:number)=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const normal=(r:()=>number)=>Math.sqrt(-2*Math.log(r()||1e-9))*Math.cos(2*Math.PI*r());

/** Simulate a reader at `wpm` turning pages of `pageWords`, returning the pace after n pages. */
function simulate(wpm:number,pages:number,seed=1,pageWords=250,start:ReadingPace={},device='d'){
  const r=rng(seed);let pace=start;
  for(let i=0;i<pages;i++){
    const speed=wpm*Math.exp(0.18*normal(r));
    pace=addPaceSample(pace,device,pageWords,pageWords*60/speed);
  }
  return pace;
}

describe('pace converges on the true speed and keeps improving',()=>{
  it('regular readers: error shrinks as more is read',()=>{
    const errors=[10,40,160,640].map(n=>{const errs=[1,2,3,4,5].map(seed=>Math.abs(readingSpeed(simulate(320,n,seed))-320)/320);return errs.reduce((a,b)=>a+b)/errs.length;});
    expect(errors[3]).toBeLessThan(errors[0]);
    expect(errors[3]).toBeLessThan(0.06);
  });
  it('slow and fast readers are both learned within a few pages, not mistaken for anomalies',()=>{
    for(const wpm of [120,180,230,330,450]){
      const est=readingSpeed(simulate(wpm,30,7));
      expect(Math.abs(est-wpm)/wpm).toBeLessThan(0.2);
    }
  });
  it('interval narrows with data and flags when still estimating',()=>{
    expect(paceIsEstimating({})).toBe(true);
    const few=readingSpeedRange(simulate(250,3)),many=readingSpeedRange(simulate(250,300));
    expect(few.high-few.low).toBeGreaterThan(many.high-many.low);
    expect(paceIsEstimating(simulate(250,10))).toBe(false);
  });
  it('is not thrown off by skim bursts or pauses mixed into steady reading',()=>{
    const r=rng(11);let pace:ReadingPace={},clean:ReadingPace={};
    for(let i=0;i<200;i++){
      const speed=260*Math.exp(0.15*normal(r));
      clean=addPaceSample(clean,'d',250,250*60/speed);
      pace=addPaceSample(pace,'d',250,250*60/speed);
      if(i>20&&i%10===0)pace=addPaceSample(pace,'d',500,40);
      if(i>20&&i%13===0)pace=addPaceSample(pace,'d',60,170);
    }
    expect(Math.abs(readingSpeed(pace)-readingSpeed(clean))/readingSpeed(clean)).toBeLessThan(0.06);
  });
  it('follows a real change in habits instead of staying anchored to history',()=>{
    let pace=simulate(200,400,3);
    expect(Math.abs(readingSpeed(pace)-200)).toBeLessThan(20);
    pace=simulate(320,120,4,250,pace);
    expect(readingSpeed(pace)).toBeGreaterThan(270);
  });
  it('keeps legacy entries usable and merges devices',()=>{
    const legacy={old:{samples:40,words:9200,seconds:2400}};
    expect(Math.abs(readingSpeed(legacy)-230)).toBeLessThan(10);
    const both=simulate(300,60,5,250,legacy,'new');
    expect(readingSpeed(both)).toBeGreaterThan(readingSpeed(legacy));
  });
  it('pools short pages (poems, dialogue) instead of discarding them',()=>{
    const t=new PaceTracker();t.observe(0,0);
    expect(t.observe(8,4000)).toBeUndefined();expect(t.observe(16,8000)).toBeUndefined();
    expect(t.observe(30,12000)).toEqual({words:30,seconds:12});
  });
  it('never leaves its valid range for absurd input',()=>{
    let pace:ReadingPace={};
    for(const [w,s] of [[0,0],[NaN,5],[1e9,1],[250,-5],[250,Infinity]])pace=addPaceSample(pace,'d',w as number,s as number);
    expect(readingSpeed(pace)).toBeCloseTo(230,5);
  });
});

describe('activity credit under real and pathological reading',()=>{
  const read=(t:ActivityTracker,turns:[number,number][],wpm=230)=>turns.map(([w,ms])=>t.observe(w,ms,wpm));
  it('credits steady reading in full',()=>{
    const t=new ActivityTracker();
    const out=read(t,[[0,0],[250,65000],[500,130000],[750,195000]]);
    expect(out.filter(Boolean)).toHaveLength(3);
    expect(out.reduce((a,c)=>a+(c?.words||0),0)).toBe(750);
  });
  it('rapid flipping and flipping back and forth earns nothing',()=>{
    const t=new ActivityTracker();
    const out=read(t,[[0,0],[250,500],[500,1000],[750,1500],[500,2000],[750,2500],[250,3000]]);
    expect(out.filter(Boolean)).toHaveLength(0);
  });
  it('re-reading the same page in one session is not credited twice',()=>{
    const t=new ActivityTracker();
    const a=read(t,[[0,0],[250,65000],[0,70000],[250,135000]]);
    expect(a[1]?.words).toBe(250);expect(a[3]).toBeUndefined();
  });
  it('a jump through contents is navigation, not reading',()=>{
    const t=new ActivityTracker();
    expect(read(t,[[0,0],[5000,60000]])[1]).toBeUndefined();
  });
  it('a screen left on credits at most a few pages of time',()=>{
    const t=new ActivityTracker();t.observe(0,0);
    const credit=t.observe(250,3*3600*1000)!;
    expect(credit.seconds).toBeLessThanOrEqual(164);
  });
  it('slow readers on dense pages are credited fully',()=>{
    const t=new ActivityTracker();t.observe(0,0);
    expect(t.observe(250,170000,120)?.seconds).toBe(170);
  });
  it('pauses (reset) never create phantom time; a rebased session continues cleanly',()=>{
    const t=new ActivityTracker();t.observe(0,0);t.observe(250,65000);
    t.reset();
    expect(t.observe(500,5000000)).toBeUndefined();
    expect(t.observe(750,5065000)?.words).toBe(250);
  });
  it('engagement uses visibility and recent input, so split screens and phones still count',()=>{
    const limit=idleLimitMs(230);
    expect(limit).toBeGreaterThanOrEqual(30000);expect(limit).toBeLessThanOrEqual(180000);
    expect(isEngaged(true,false,5000,limit)).toBe(true);
    expect(isEngaged(true,false,limit+1,limit)).toBe(false);
    expect(isEngaged(false,true,0,limit)).toBe(false);
    expect(idleLimitMs(60)).toBeGreaterThan(idleLimitMs(500));
  });
});

describe('streaks and daily totals',()=>{
  const at=(day:string,h=12)=>new Date(`${day}T${String(h).padStart(2,'0')}:00:00`);
  it('a day needs a minute of engaged reading and real words; flipping never keeps a streak',()=>{
    let log:ReadingLog={};
    log=addActivity(log,'p',{pages:1,words:250,seconds:65},at('2026-10-30'));
    log=addActivity(log,'p',{pages:1,words:30,seconds:20},at('2026-10-31'));
    const days=dailyTotals(log,'2026-10-31');
    expect(days.get('2026-10-30')?.counts).toBe(true);
    expect(days.get('2026-10-31')?.counts).toBe(false);
    expect(streakOf(qualifyingDays(days).keys(),'2026-10-31').current).toBe(1);
  });
  it('reading split across two devices adds up to one qualifying day',()=>{
    let log:ReadingLog={};
    log=addActivity(log,'phone',{pages:1,words:60,seconds:35},at('2026-10-31'));
    log=addActivity(log,'laptop',{pages:1,words:70,seconds:35},at('2026-10-31'));
    expect(dailyTotals(log,'2026-10-31').get('2026-10-31')?.counts).toBe(true);
  });
  it('days counted by the old one-page rule are never re-judged',()=>{
    const log:ReadingLog={'2026-10-29.p':{pages:1,words:0,seconds:0},'2026-10-30.p':{pages:2,words:10,seconds:5}};
    const q=qualifyingDays(dailyTotals(log,'2026-10-31'));
    expect([...q.keys()]).toEqual(['2026-10-29','2026-10-30']);
    const more=addActivity(log,'p',{pages:1,words:5,seconds:3},at('2026-10-30'));
    expect(dailyTotals(more,'2026-10-31').get('2026-10-30')?.counts).toBe(true);
  });
  it('a wrong clock set far into the future cannot create or extend a streak',()=>{
    const log:ReadingLog={'2027-03-01.p_v2':{pages:50,words:9000,seconds:4000},'2026-10-31.p_v2':{pages:3,words:700,seconds:300}};
    const days=dailyTotals(log,'2026-10-31');
    expect(days.has('2027-03-01')).toBe(false);
    expect(streakOf(qualifyingDays(days).keys(),'2026-10-31').current).toBe(1);
  });
  it('the day is fixed when written, and a 4 am day start keeps late reading on its day',()=>{
    const late=new Date('2026-10-31T01:30:00');
    expect(dayKey(late)).toBe('2026-10-31');
    expect(dayKey(late,4)).toBe('2026-10-30');
    const log=addActivity({},'p',{pages:1,words:150,seconds:70},late,4);
    expect(Object.keys(log)[0].startsWith('2026-10-30.')).toBe(true);
  });
  it('merging offline devices only ever adds days',()=>{
    const a:ReadingLog={'2026-10-29.p_v2':{pages:3,words:600,seconds:200}};
    const b:ReadingLog={'2026-10-30.l_v2':{pages:3,words:600,seconds:200},'2026-10-29.p_v2':{pages:1,words:100,seconds:30}};
    const merged=mergeReadingLog(a,b);
    expect(Object.keys(merged).sort()).toEqual(['2026-10-29.p_v2','2026-10-30.l_v2']);
    expect(merged['2026-10-29.p_v2'].pages).toBe(3);
  });
  it('simulated 60 days of mixed reading produces the streak a human would expect',()=>{
    let log:ReadingLog={};
    const r=rng(9);const expectedDays:string[]=[];
    for(let d=0;d<60;d++){
      const day=new Date(2026,8,1+d,20);
      const key=dayKey(day);
      if(d%9!==8){
        const t=new ActivityTracker();t.observe(0,0);let w=0,ms=0;
        for(let p=0;p<6;p++){w+=250;ms+=(55+r()*30)*1000;const c=t.observe(w,ms);if(c)log=addActivity(log,'p',c,day);}
        expectedDays.push(key);
      }
    }
    const days=dailyTotals(log,'2026-10-30');
    expect([...qualifyingDays(days).keys()].sort()).toEqual(expectedDays.filter(k=>k<='2026-10-30').sort());
    expect(streakOf(qualifyingDays(days).keys(),'2026-10-30').longest).toBe(8);
  });
});

describe('spaced repetition',()=>{
  const DAY=86400000;
  const card={id:'a',quote:'x'.repeat(100),note:''};
  it('recall probability falls with time and is high at the scheduled interval',()=>{
    const r1=review(card,3,0);
    expect(r1.interval).toBeGreaterThanOrEqual(1);
    expect(retrievability(r1.interval,r1.stability!)).toBeGreaterThan(0.85);
    expect(retrievability(0,3)).toBe(1);expect(retrievability(30,3)).toBeLessThan(retrievability(3,3));
  });
  it('grades order the intervals and Again always returns tomorrow',()=>{
    const p=previewIntervals(card,0);
    expect(p[1]).toBe(1);expect(p[1]).toBeLessThanOrEqual(p[2]);expect(p[2]).toBeLessThanOrEqual(p[3]);expect(p[3]).toBeLessThanOrEqual(p[4]);
  });
  it('intervals grow with each success and shrink after a lapse',()=>{
    let c:{id:string;review?:Review}={id:'a'};let now=0;const gaps:number[]=[];
    for(let i=0;i<6;i++){const rv=review(c,3,now);gaps.push(rv.interval);now=rv.due;c={...c,review:rv};}
    for(let i=1;i<gaps.length;i++)expect(gaps[i]).toBeGreaterThan(gaps[i-1]);
    const lapsed=review(c,1,now);
    expect(lapsed.interval).toBe(1);expect(lapsed.stability!).toBeLessThan(c.review!.stability!);expect(lapsed.lapses).toBe(1);
  });
  it('reviewing on time adds more stability than reviewing early',()=>{
    const base=review({id:'a'},3,0);
    const early=review({id:'a',review:base},3,base.due-base.interval*DAY*0.9);
    const onTime=review({id:'a',review:base},3,base.due);
    expect(onTime.stability!).toBeGreaterThan(early.stability!);
  });
  it('legacy fixed-ladder cards migrate without losing their schedule',()=>{
    const legacy={id:'l',review:{due:20*DAY,interval:16}};
    const m=memoryState(legacy,20*DAY)!;
    expect(m.stability).toBe(16);
    const next=review(legacy,3,20*DAY);
    expect(next.interval).toBeGreaterThan(16);expect(next.interval).toBeLessThanOrEqual(MAX_INTERVAL);
  });
  it('simulated learner: recall stays near the target retention',()=>{
    const r=rng(21);let ok=0,total=0;
    for(let n=0;n<200;n++){
      let c:{id:string;review?:Review}={id:`c${n}`};let now=0;
      for(let k=0;k<8;k++){
        const m=memoryState(c,now);
        const p=m?retrievability((now-m.last)/DAY,m.stability*0.9):0.9;
        const recalled=r()<p;
        if(m){total++;if(recalled)ok++;}
        const rv=review(c,(recalled?3:1) as Grade,now);now=rv.due;c={...c,review:rv};
      }
    }
    expect(ok/total).toBeGreaterThan(0.8);expect(ok/total).toBeLessThan(0.97);
  });
  it('a long absence returns a capped, most-forgotten-first queue',()=>{
    const cards=Array.from({length:100},(_,i)=>({id:`c${i}`,review:{due:i*DAY,interval:5,stability:5,difficulty:5,reps:2,lapses:0,last:(i-5)*DAY} as Review}));
    const q=dueQueue(cards,200*DAY,20);
    expect(q).toHaveLength(20);expect(q[0].id).toBe('c0');
  });
  it('flags cards that keep failing',()=>{
    let c:{id:string;review?:Review}={id:'x'};let now=0;
    for(let i=0;i<9;i++){const rv=review(c,1,now);now=rv.due;c={...c,review:rv};}
    expect(isLeech(c)).toBe(true);
  });
  it('is deterministic and bounded for odd input',()=>{
    const a=review({id:'z',review:{due:0,interval:0}},4,5*DAY),b=review({id:'z',review:{due:0,interval:0}},4,5*DAY);
    expect(a).toEqual(b);expect(a.interval).toBeGreaterThanOrEqual(1);
    const huge=review({id:'h',review:{due:0,interval:3650,stability:1e6,difficulty:1,reps:50,lapses:0,last:0}},4,3650*DAY);
    expect(huge.interval).toBe(MAX_INTERVAL);
  });
});

describe('position safety',()=>{
  it('only deliberate positions become stable; dragging through a book does not',()=>{
    const s=new StablePositions(4000,3);
    expect(s.observe('a',0)).toBe(false);expect(s.observe('b',1000)).toBe(false);expect(s.observe('c',2000)).toBe(false);
    expect(s.recent()).toEqual([]);
    expect(s.observe('c',7000)).toBe(true);
    expect(s.observe('d',8000)).toBe(false);expect(s.observe('d',13000)).toBe(true);
    expect(s.previous()?.key).toBe('c');expect(s.recent()).toHaveLength(2);
  });
  it('prompts only when another device is clearly ahead',()=>{
    const local={wordsRead:1000,updatedAt:1,deviceId:'a'};
    expect(shouldPromptContinue(local,{wordsRead:1500,updatedAt:2,deviceId:'b'})).toBe(false);
    expect(shouldPromptContinue(local,{wordsRead:9000,updatedAt:2,deviceId:'b'})).toBe(true);
    expect(shouldPromptContinue(local,{wordsRead:9000,updatedAt:2,deviceId:'a'})).toBe(false);
    expect(shouldPromptContinue(local,{wordsRead:9000,updatedAt:0,deviceId:'b'})).toBe(false);
  });
});
