import {describe,it,expect} from 'vitest';
import {analyzePdfPage,normalizePdfText,dominantSize,importReport,type PdfTextItem} from '../lib/readwind/pdf-layout';
const view={width:600,height:800,transform:[1,0,0,-1,0,800]};
const item=(str:string,x:number,y:number,size=12,width=str.length*6):PdfTextItem=>({str,transform:[size,0,0,size,x,800-y],height:size,width});
describe('PDF layout analysis',()=>{
 it('reassembles fragmented characters without adding spaces inside words',()=>{expect(analyzePdfPage([item('H',30,80,12,7),item('e',37,80,12,6),item('llo',43,80,12,16),item('world',66,80)],view,0).lines[0].text).toBe('Hello world');});
 it('sorts stream fragments geometrically',()=>{expect(analyzePdfPage([item('second',30,100),item('first',30,80)],view,0).lines.map(l=>l.text)).toEqual(['first','second']);});
 it('detects columns and reads each column top to bottom',()=>{const items=[0,1,2,3].flatMap(n=>[item(`Right ${n}`,340,100+n*20,12,80),item(`Left ${n}`,40,100+n*20,12,80)]);const r=analyzePdfPage(items,view,0);expect(r.report.issues).toContain('columns');expect(r.lines.map(l=>l.text)).toEqual(['Left 0','Left 1','Left 2','Left 3','Right 0','Right 1','Right 2','Right 3']);});
 it('normalizes ligatures and discretionary hyphens',()=>{expect(normalizePdfText('ﬁne ﬂowers soft\u00adhyphen')).toBe('fine flowers softhyphen');});
 it('weights body size by content rather than numerous tiny labels',()=>{expect(dominantSize([{size:18,text:'A long paragraph of body text'},...Array.from({length:10},()=>({size:6,text:'1'}))])).toBe(18);});
 it('flags scans without requiring OCR',()=>{const r=analyzePdfPage([],view,0);expect(r.report.issues).toContain('scanned');expect(importReport([r.report]).recommendedMode).toBe('original');});
 it('flags right-to-left and unmapped characters',()=>{const r=analyzePdfPage([{...item('שלום \ufffd',20,80),dir:'rtl'}],view,0);expect(r.report.issues).toContain('rtl');expect(r.report.issues).toContain('text-mapping');});
 it('honors viewport rotation rather than unrotated PDF coordinates',()=>{const r=analyzePdfPage([item('turn',40,80)],{width:800,height:600,transform:[0,1,1,0,0,0]},0);expect(r.report.issues).toContain('rotated-text');expect(r.lines[0].x).toBe(720);});
});
