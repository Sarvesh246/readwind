import {describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {PaceTracker,readingSpeed,addPaceSample,mergeReadingPace,validPaceSample} from '../lib/readwind/reading-pace';
import {persistSettings} from '../lib/readwind/settings-sync';
import {settings} from '../lib/readwind/schemas';
import {defaults} from '../lib/readwind/types';

describe('account reading pace',()=>{
  it('learns a shared pace with a stable initial estimate',()=>{
    expect(readingSpeed()).toBe(230);
    const pace=addPaceSample({},'device-a',200,60);
    expect(readingSpeed(pace)).toBe(220);
    expect(readingSpeed(addPaceSample(pace,'device-b',100,60))).toBe(190);
  });
  it('rejects rapid flips, large jumps, backwards travel and idle gaps',()=>{
    for(const [words,seconds] of [[200,2],[200,181],[-200,60],[5000,60],[2,60],[200,NaN],[NaN,60],[200,1]])expect(validPaceSample(words,seconds)).toBe(false);
    expect(validPaceSample(230,60)).toBe(true);
  });
  it('measures only a current reader session and resets after interruptions',()=>{
    const tracker=new PaceTracker();
    expect(tracker.observe(0,0)).toBeUndefined();
    expect(tracker.observe(230,60000)).toEqual({words:230,seconds:60});
    expect(tracker.observe(460,61000)).toBeUndefined();
    expect(tracker.observe(690,121000)).toEqual({words:230,seconds:60});
    tracker.reset();expect(tracker.observe(920,181000)).toBeUndefined();
    expect(tracker.observe(690,241000)).toBeUndefined();
    expect(tracker.observe(920,500000)).toBeUndefined();
  });
  it('accumulates small scroll movements without treating stationary renders as reading',()=>{
    const tracker=new PaceTracker();tracker.observe(0,0);
    tracker.observe(0,5000);tracker.observe(10,10000);
    expect(tracker.observe(40,20000)).toEqual({words:40,seconds:20});
  });
  it('bounds historical influence so pace adapts over time',()=>{
    const pace=addPaceSample({a:{samples:100,words:27600,seconds:7200}},'a',100,60);
    expect(pace.a.seconds).toBe(7200);expect(pace.a.samples).toBe(101);
    expect(readingSpeed(pace)).toBeLessThan(230);
  });
  it('ignores skimming bursts and long pauses once a baseline exists',()=>{
    const base={a:{samples:10,words:2300,seconds:600+300}};
    expect(addPaceSample(base,'a',600,60)).toBe(base);
    expect(addPaceSample(base,'a',20,60)).toBe(base);
    expect(addPaceSample(base,'a',200,60)).not.toBe(base);
  });
  it('merges independent devices and ignores older samples',()=>{
    const latest={a:{samples:2,words:400,seconds:120}};
    expect(mergeReadingPace(latest,{a:{samples:1,words:200,seconds:60},b:{samples:1,words:100,seconds:60}})).toEqual({...latest,b:{samples:1,words:100,seconds:60}});
    expect(settings.parse({...defaults,readingPace:latest}).readingPace).toEqual(latest);
    expect(settings.safeParse({...defaults,readingPace:{a:{samples:1,words:100,seconds:Infinity}}}).success).toBe(false);
  });
  it('atomically retains pace across stale device saves, appearance changes and other accounts',async()=>{
    const pg=new PGlite();
    try{
      await pg.exec('CREATE TABLE folio_settings(owner_id text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz DEFAULT now())');
      const tag=(strings:TemplateStringsArray,...values:unknown[])=>pg.query(strings.reduce((sql,s,i)=>sql+(i?`$${i}`:'')+s,''),values);
      const a={samples:2,words:400,seconds:120}, b={samples:1,words:100,seconds:60};
      await persistSettings(tag,'alice',{...defaults,readingPace:{a}});
      await persistSettings(tag,'alice',{...defaults,readingPace:{b}});
      await persistSettings(tag,'alice',{...defaults,paper:'Dusk',readingPace:{a:{samples:1,words:200,seconds:60}}});
      await persistSettings(tag,'alice',{...defaults,paper:'Night'});
      await persistSettings(tag,'bob',defaults);
      const rows=await pg.query<{owner_id:string;data:typeof defaults}>('SELECT owner_id,data FROM folio_settings ORDER BY owner_id');
      expect(rows.rows[0].data.readingPace).toEqual({a,b});
      expect(rows.rows[0].data.paper).toBe('Night');
      expect(rows.rows[1].data.readingPace).toBeUndefined();
    }finally{await pg.close();}
  },30000);
});
