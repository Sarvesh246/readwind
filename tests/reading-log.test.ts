import {describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {ActivityTracker,addActivity,dailyTotals,dayFromNumber,dayNumber,mergeReadingLog,statsOf,streakOf} from '../lib/readwind/reading-log';
import {persistSettings} from '../lib/readwind/settings-sync';
import {settings} from '../lib/readwind/schemas';
import {defaults} from '../lib/readwind/types';

const at=(day:string,h=12)=>new Date(`${day}T${String(h).padStart(2,'0')}:00:00`);

describe('streaks',()=>{
  it('counts consecutive days and keeps yesterday’s streak alive until today ends',()=>{
    expect(streakOf(['2026-10-29','2026-10-30','2026-10-31'],'2026-10-31')).toMatchObject({current:3,longest:3,readToday:true,atRisk:false});
    expect(streakOf(['2026-10-29','2026-10-30'],'2026-10-31')).toMatchObject({current:2,readToday:false,atRisk:true});
    expect(streakOf(['2026-10-28'],'2026-10-31')).toMatchObject({current:0,longest:1});
    expect(streakOf([],'2026-10-31')).toMatchObject({current:0,longest:0,total:0});
  });
  it('tracks the longest run separately and crosses month and DST boundaries',()=>{
    const s=streakOf(['2026-03-07','2026-03-08','2026-03-09','2026-03-20','2026-03-21'],'2026-03-21');
    expect(s.longest).toBe(3);expect(s.current).toBe(2);
    expect(dayFromNumber(dayNumber('2026-02-28')+1)).toBe('2026-03-01');
  });
});
describe('reading log',()=>{
  it('adds credit per device and day, and a day needs a page to count',()=>{
    let log=addActivity({}, 'phone', {pages:1,words:250,seconds:70}, at('2026-10-31'));
    log=addActivity(log,'phone',{pages:1,words:240,seconds:60},at('2026-10-31'));
    log=addActivity(log,'laptop',{pages:1,words:0,seconds:0},at('2026-10-31'));
    log=addActivity(log,'phone',{pages:0,words:0,seconds:0},at('2026-10-30'));
    const days=dailyTotals(log);
    expect(days.get('2026-10-31')).toEqual({day:'2026-10-31',pages:3,words:490,seconds:130});
    expect(days.has('2026-10-30')).toBe(false);
  });
  it('merges devices without double counting and drops old days',()=>{
    const a={'2026-10-31.p':{pages:2,words:400,seconds:100}};
    const merged=mergeReadingLog(a,{'2026-10-31.p':{pages:1,words:200,seconds:50},'2026-10-31.l':{pages:1,words:100,seconds:30}});
    expect(merged['2026-10-31.p']).toEqual(a['2026-10-31.p']);
    expect(Object.keys(merged).sort()).toEqual(['2026-10-31.l','2026-10-31.p']);
    expect(Object.keys(mergeReadingLog({'2001-01-01.p':{pages:1,words:1,seconds:1}},{}))).toEqual([]);
  });
  it('summarises stats and the last seven days',()=>{
    const log={'2026-10-30.p':{pages:3,words:600,seconds:240},'2026-10-31.p':{pages:5,words:1000,seconds:420}};
    const s=statsOf(log,'2026-10-31');
    expect(s).toMatchObject({words:1600,seconds:660,pages:8,activeDays:2,firstDay:'2026-10-30'});
    expect(s.bestDay?.day).toBe('2026-10-31');expect(s.last7).toHaveLength(7);expect(s.last7[6].day).toBe('2026-10-31');
  });
  it('validates synced logs',()=>{
    expect(settings.safeParse({...defaults,readingLog:{'2026-10-31.p':{pages:1,words:10,seconds:5}}}).success).toBe(true);
    expect(settings.safeParse({...defaults,readingLog:{'bad key':{pages:1,words:10,seconds:5}}}).success).toBe(false);
    expect(settings.safeParse({...defaults,readingLog:{'2026-10-31.p':{pages:-1,words:10,seconds:5}}}).success).toBe(false);
  });
  it('merges logs atomically on the server and keeps them across appearance saves',async()=>{
    const pg=new PGlite();
    try{
      await pg.exec('CREATE TABLE folio_settings(owner_id text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz DEFAULT now())');
      const tag=(strings:TemplateStringsArray,...values:unknown[])=>pg.query(strings.reduce((sql,s,i)=>sql+(i?`$${i}`:'')+s,''),values);
      const day=new Date().toISOString().slice(0,10);
      const a={pages:2,words:400,seconds:120},older={pages:1,words:200,seconds:60};
      await persistSettings(tag,'alice',{...defaults,readingLog:{[`${day}.a`]:a}});
      await persistSettings(tag,'alice',{...defaults,readingLog:{[`${day}.a`]:older,[`${day}.b`]:older,'2001-01-01.a':older}});
      await persistSettings(tag,'alice',{...defaults,paper:'Night'});
      const rows=await pg.query<{data:typeof defaults}>('SELECT data FROM folio_settings');
      expect(rows.rows[0].data.readingLog).toEqual({[`${day}.a`]:a,[`${day}.b`]:older});
      expect(rows.rows[0].data.paper).toBe('Night');
    }finally{await pg.close();}
  },30000);
});
describe('activity tracker',()=>{
  it('credits a page right away and real reading time for plausible pace',()=>{
    const t=new ActivityTracker();
    expect(t.observe(0,0)).toBeUndefined();
    expect(t.observe(250,70000)).toEqual({pages:1,words:250,seconds:70});
  });
  it('still counts a quickly flipped page for the streak but not for stats',()=>{
    const t=new ActivityTracker();t.observe(0,0);
    expect(t.observe(250,1500)).toEqual({pages:1,words:0,seconds:0});
    expect(t.observe(500,300000)).toEqual({pages:1,words:0,seconds:0});
  });
  it('ignores scroll noise, accumulates small moves and rebases when going back',()=>{
    const t=new ActivityTracker();t.observe(100,0);
    expect(t.observe(100,5000)).toBeUndefined();
    expect(t.observe(110,9000)).toBeUndefined();
    expect(t.observe(150,30000)).toEqual({pages:1,words:50,seconds:30});
    expect(t.observe(40,40000)).toBeUndefined();
    t.reset();expect(t.observe(400,50000)).toBeUndefined();
  });
});
