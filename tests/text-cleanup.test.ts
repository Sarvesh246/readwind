import {describe,it,expect} from 'vitest';
import {bookWordEvidence,joinPrintedLine} from '../lib/readwind/text-cleanup';
describe('faithful line joining',()=>{
 it('preserves compound words instead of inventing new spellings',()=>{
  const words=bookWordEvidence([[{text:'The early-morning light returned.'},{text:'Preparation matters.'}]]);
  expect(joinPrintedLine('The early-','morning light',true,words)).toEqual({text:'The early-morning light',fixed:false});
  expect(joinPrintedLine('Prepa-','ration matters',true,words)).toEqual({text:'Preparation matters',fixed:true});
 });
 it('keeps uncertain hyphens and honors the cleanup option',()=>{
  expect(joinPrintedLine('An unfamiliar-','compound',true,new Set()).text).toBe('An unfamiliar-compound');
  expect(joinPrintedLine('Prepa-','ration',false,new Set(['preparation'])).text).toBe('Prepa-ration');
  expect(joinPrintedLine('A complete thought.','Another thought.',true,new Set()).text).toBe('A complete thought. Another thought.');
 });
});
