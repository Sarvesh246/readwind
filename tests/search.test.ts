import {describe,it,expect} from 'vitest';
import {searchBook} from '../lib/readwind/search';
import type {Book} from '../lib/readwind/types';
const texts=[
 'The old lighthouse keeper didn’t trust the sea, and he never left the tower after dark.',
 'Café owners along the harbour were walking home when the storm broke over Zürich.',
 'She whispered, “You cannot outrun what you have already become.”',
 'Nothing about the garden had changed except the gate, which now stood open.',
 'The dragon slept in a cave beneath the mountain while the villagers pretended not to know.',
];
const book:Pick<Book,'sections'>={sections:[{id:'s',title:'S',heading:true,blocks:texts.map(text=>({type:'p' as const,text}))}]};
const top=(q:string)=>searchBook(book,q).hits.map(h=>h.at.block);
describe('book search',()=>{
 it('still finds exact words and phrases, ignoring case',()=>{
  expect(top('LIGHTHOUSE')).toEqual([0]);
  expect(top('storm broke over')[0]).toBe(1);
 });
 it('ignores apostrophe style, missing apostrophes and accents',()=>{
  expect(top("didn't trust")[0]).toBe(0);
  expect(top('didnt trust')[0]).toBe(0);
  expect(top('cafe owners')[0]).toBe(1);
  expect(top('zurich')[0]).toBe(1);
 });
 it('tolerates typos and word endings',()=>{
  expect(top('lighthose keeper')[0]).toBe(0);
  expect(top('walk home')[0]).toBe(1);
  expect(top('outrunn')[0]).toBe(2);
 });
 it('finds a half-remembered passage with missing or reordered words',()=>{
  expect(top('cannot outrun what you become')[0]).toBe(2);
  expect(top('cave dragon slept')[0]).toBe(4);
  expect(top('the garden gate stood open')[0]).toBe(3);
  expect(top('villagers pretended know mountain')[0]).toBe(4);
 });
 it('ranks an exact phrase above a loose match',()=>{
  const loose:Pick<Book,'sections'>={sections:[{id:'s',title:'S',heading:true,blocks:[
   {type:'p',text:'The cave was dark and the dragon had slept elsewhere.'},
   {type:'p',text:'A dragon slept in the cave.'},
  ]}]};
  expect(searchBook(loose,'dragon slept').hits.map(h=>h.at.block)).toEqual([1,0]);
 });
 it('does not match unrelated text or one-letter queries',()=>{
  expect(top('spaceship engine')).toEqual([]);
  expect(top('x')).toEqual([]);
  expect(top('   ')).toEqual([]);
 });
 it('caps results but reports the total',()=>{
  const many:Pick<Book,'sections'>={sections:[{id:'s',title:'S',heading:true,blocks:Array.from({length:80},()=>({type:'p' as const,text:'rain fell'}))}]};
  const r=searchBook(many,'rain',60);
  expect(r.hits).toHaveLength(60);
  expect(r.total).toBe(80);
 });
 it('jumps to the start of the matched words',()=>{
  expect(searchBook(book,'gate').hits[0].at).toEqual({section:0,block:3,offset:texts[3].indexOf('gate')});
 });
});
