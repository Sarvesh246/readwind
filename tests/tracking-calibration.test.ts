import {describe,it,expect} from 'vitest';
import {addPaceSample,addBookPaceSample,addCalibration,calibration,speedForBook,readingSpeed,mergeReadingPace,BOOK_PREFIX,type ReadingPace} from '../lib/readwind/reading-pace';
import {addActivity,dailyTotals,dayKey,mergeReadingLog,setLogSession,setDayStartHour} from '../lib/readwind/reading-log';
import {review,mergeReviewCal,recordOutcome,stabilityScale,predictedRecall,type ReviewCal} from '../lib/readwind/spaced-repetition';
import {settings} from '../lib/readwind/schemas';
import {defaults} from '../lib/readwind/types';
import {bookDensity} from '../lib/readwind/anchors';

const rng=(seed:number)=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const normal=(r:()=>number)=>Math.sqrt(-2*Math.log(r()||1e-9))*Math.cos(2*Math.PI*r());

describe('per-book pace, density and calibration',()=>{
  const sim=(book:string,wpm:number,n:number,seed:number,start:ReadingPace={})=>{
    const r=rng(seed);let pace=start;
    for(let i=0;i<n;i++){const speed=wpm*Math.exp(0.15*normal(r));pace=addPaceSample(pace,'d',250,250*60/speed);pace=addBookPaceSample(pace,book,250,250*60/speed);}
    return pace;
  };
  it('learns that one book is slower than another for the same reader',()=>{
    let pace=sim('slow',150,60,1);pace=sim('fast',320,60,2,pace);
    const slow=speedForBook(pace,'slow'),fast=speedForBook(pace,'fast'),unseen=speedForBook(pace,'new');
    expect(slow).toBeLessThan(unseen);expect(fast).toBeGreaterThan(unseen);
    expect(Math.abs(slow-150)/150).toBeLessThan(0.2);expect(Math.abs(fast-320)/320).toBeLessThan(0.2);
  });
  it('a new book starts from the general pace and moves toward its own as it is read',()=>{
    const base=sim('a',250,80,3);
    const general=speedForBook(base,'b');
    expect(Math.abs(general-readingSpeed(base))).toBeLessThan(1);
    const after=sim('b',160,3,4,base),later=sim('b',160,40,5,base);
    expect(speedForBook(later,'b')).toBeLessThan(speedForBook(after,'b'));
    expect(speedForBook(after,'b')).toBeLessThan(general);
  });
  it('density converts between standard words and a book own words',()=>{
    const pace=sim('a',250,60,6);
    expect(speedForBook(pace,'a',2)).toBeCloseTo(speedForBook(pace,'a',1)/2,5);
    expect(speedForBook(pace,'a',0.5)).toBeGreaterThan(speedForBook(pace,'a',1));
  });
  it('measures density from the text itself',()=>{
    const mk=(text:string)=>({sections:[{blocks:[{type:'paragraph',text}]}]}) as never;
    const plain=bookDensity(mk('the cat sat on the mat and the dog ran '.repeat(50)));
    const dense=bookDensity(mk('extraordinarily unconventional interdisciplinary '.repeat(50)));
    expect(dense).toBeGreaterThan(plain);expect(plain).toBeGreaterThan(0.25);expect(plain).toBeLessThan(2.5);
  });
  it('calibration learns that estimates run short and lengthens time-left, within bounds',()=>{
    let pace=sim('a',250,60,7);const before=speedForBook(pace,'a');
    // Estimates are made with the current correction, so each stretch reports only the error that remains.
    for(let i=0;i<30;i++)pace=addCalibration(pace,'d',Math.log(1.25)-calibration(pace));
    expect(calibration(pace)).toBeGreaterThan(0.15);expect(calibration(pace)).toBeLessThan(0.26);
    expect(speedForBook(pace,'a')).toBeLessThan(before);
    for(let i=0;i<200;i++)pace=addCalibration(pace,'d',5);
    expect(calibration(pace)).toBeLessThanOrEqual(0.5);
    expect(calibration({})).toBe(0);expect(addCalibration({},'d',NaN)).toEqual({});
  });
  it('per-book and calibration entries merge across devices like any pace entry and validate on the server',()=>{
    let a=sim('b1',200,10,8);const b=sim('b1',200,30,9);
    a=addCalibration(a,'d',0.1);
    const merged=mergeReadingPace(a,b);
    expect(merged[BOOK_PREFIX+'b1'].samples).toBe(Math.max(a[BOOK_PREFIX+'b1'].samples,b[BOOK_PREFIX+'b1'].samples));
    expect(Object.keys(merged).some(k=>k.startsWith('cal-'))).toBe(true);
    expect(settings.safeParse({...defaults,readingPace:merged}).success).toBe(true);
  });
});

describe('session ledger and day start',()=>{
  const at=(day:string,h=12)=>new Date(`${day}T${String(h).padStart(2,'0')}:00:00`);
  it('separate sessions write separate counters, so no history can overwrite another',()=>{
    setLogSession('aaa');
    const before=addActivity({},'dev',{pages:5,words:1000,seconds:400},at('2026-10-31'));
    // A backup taken now is restored later on a device that keeps its id and keeps reading.
    const restored=before;
    setLogSession('bbb');
    const live=addActivity(addActivity(before,'dev',{pages:4,words:800,seconds:300},at('2026-10-31')),'dev',{pages:2,words:400,seconds:150},at('2026-10-31'));
    setLogSession('ccc');
    const other=addActivity(restored,'dev',{pages:3,words:600,seconds:200},at('2026-10-31'));
    setLogSession('s0');
    const total=dailyTotals(mergeReadingLog(live,other),'2026-10-31').get('2026-10-31')!;
    expect(total.pages).toBe(5+6+3);
    expect(total.seconds).toBe(400+450+200);
  });
  it('the same session is idempotent when merged with itself',()=>{
    setLogSession('ddd');
    const log=addActivity({},'dev',{pages:2,words:300,seconds:120},at('2026-10-31'));
    setLogSession('s0');
    expect(mergeReadingLog(log,log)).toEqual(log);
  });
  it('the chosen day start moves late-night reading to the day it began',()=>{
    const late=new Date('2026-10-31T01:30:00');
    setDayStartHour(4);
    expect(dayKey(late)).toBe('2026-10-30');
    setDayStartHour(0);
    expect(dayKey(late)).toBe('2026-10-31');
    setDayStartHour(99);
    expect(dayKey(late)).toBe('2026-10-31');
  });
});

describe('per-reader review tuning',()=>{
  it('does nothing until there is enough history',()=>{
    expect(stabilityScale()).toBe(1);
    let cal:ReviewCal|undefined;
    for(let i=0;i<20;i++)cal=recordOutcome(cal,0.9,false);
    expect(stabilityScale(cal)).toBe(1);
  });
  it('shortens intervals for a reader who forgets more than predicted and lengthens for one who forgets less',()=>{
    let weak:ReviewCal|undefined,strong:ReviewCal|undefined;
    const r=rng(5);
    for(let i=0;i<300;i++){weak=recordOutcome(weak,0.9,r()<0.7);strong=recordOutcome(strong,0.9,r()<0.98);}
    expect(stabilityScale(weak)).toBeLessThan(0.9);expect(stabilityScale(strong)).toBeGreaterThan(1.1);
    expect(stabilityScale(weak)).toBeGreaterThanOrEqual(0.6);expect(stabilityScale(strong)).toBeLessThanOrEqual(1.6);
    const base=review({id:'a'},3,0),rv=(m:number)=>review({id:'a',review:base},3,base.due,0.9,m).interval;
    expect(rv(stabilityScale(weak))).toBeLessThan(rv(1));expect(rv(stabilityScale(strong))).toBeGreaterThan(rv(1));
  });
  it('trust grows with history and merging keeps the larger history',()=>{
    const small={n:40,hit:20,pred:36},big={n:400,hit:200,pred:360};
    expect(Math.abs(Math.log(stabilityScale(big)))).toBeGreaterThan(Math.abs(Math.log(stabilityScale(small))));
    expect(mergeReviewCal(small,big)).toBe(big);expect(mergeReviewCal(big,small)).toBe(big);expect(mergeReviewCal(undefined,small)).toBe(small);
  });
  it('predicts recall only for cards that have been reviewed',()=>{
    expect(predictedRecall({id:'n'})).toBeUndefined();
    const rv=review({id:'n'},3,0);
    expect(predictedRecall({id:'n',review:rv},rv.due)!).toBeGreaterThan(0.8);
  });
  it('validates in synced settings',()=>{
    expect(settings.safeParse({...defaults,dayStartHour:4,reviewCal:{n:10,hit:8,pred:9}}).success).toBe(true);
    expect(settings.safeParse({...defaults,dayStartHour:12}).success).toBe(false);
  });
});
