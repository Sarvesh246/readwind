import {describe,it,expect} from 'vitest';
import {baseForm,candidates,cleanWord,lookup,mergeEntries,parseDatamuse,parseFreeDictionary,parseWiktionary,stripHtml,wordsOf,sources} from '../lib/readwind/dictionary';

const free=[{word:'ephemeral',phonetic:'/ɪˈfɛm(ə)ɹəl/',phonetics:[{text:'/x/',audio:'https://a.example/e.mp3'}],meanings:[{partOfSpeech:'adjective',definitions:[{definition:'Lasting a short time.',example:'An ephemeral joy.',synonyms:['fleeting']}],synonyms:['brief'],antonyms:['eternal']}]}];
const wikt={en:[{partOfSpeech:'Adjective',definitions:[{definition:'Lasting for a <a href="/wiki/short">short</a> period &amp; of <a>time</a>.',parsedExamples:[{example:'<i>Fame is ephemeral.</i>'}]},{definition:'<span></span>'}]},{partOfSpeech:'Noun',definitions:[{definition:'Something that lasts a day.'}]}]};

describe('dictionary parsing',()=>{
  it('cleans selections into lookup terms',()=>{
    expect(cleanWord('  “Ephemeral,” ')).toBe('Ephemeral');
    expect(cleanWord('don’t')).toBe("don't");
    expect(cleanWord('well-known')).toBe('well-known');
    for(const bad of ['','123 ... ','x'.repeat(80),'a<b>c','a/b'])expect(cleanWord(bad)).toBeNull();
    expect(wordsOf('The quick, the QUICK fox')).toEqual(['the','quick','fox']);
  });
  it('proposes headwords for inflected forms',()=>{
    expect(candidates('running')).toEqual(expect.arrayContaining(['running','run','runn']));
    expect(candidates('studies')).toContain('study');
    expect(candidates('stopped')).toContain('stop');
    expect(candidates('boxes')).toContain('box');
    expect(candidates('on the fence')).toEqual(['on the fence']);
  });
  it('parses the free dictionary with audio, synonyms and antonyms',()=>{
    const e=parseFreeDictionary(free)!;
    expect(e).toMatchObject({word:'ephemeral',audio:'https://a.example/e.mp3',antonyms:['eternal']});
    expect(e.synonyms).toEqual(['fleeting','brief']);
    expect(parseFreeDictionary({title:'No Definitions Found'})).toBeNull();
  });
  it('parses wiktionary html safely',()=>{
    expect(stripHtml('a <b>b</b> &amp; &#233;')).toBe('a b & é');
    const e=parseWiktionary(wikt,'ephemeral')!;
    expect(e.meanings[0]).toEqual({partOfSpeech:'adjective',senses:[{definition:'Lasting for a short period & of time.',example:'Fame is ephemeral.'}]});
    expect(e.meanings).toHaveLength(2);
    expect(parseWiktionary({},'x')).toBeNull();
    expect(parseDatamuse([{word:'brief'},{word:'Brief'},{word:''}])).toEqual(['brief']);
  });
  it('merges sources without duplicating senses',()=>{
    const m=mergeEntries(parseFreeDictionary(free),parseWiktionary(wikt,'ephemeral'))!;
    expect(m.meanings.map(x=>x.partOfSpeech)).toEqual(['adjective','noun']);
    expect(m.meanings[0].senses).toHaveLength(2);
    expect(m.sources).toEqual(['Free Dictionary','Wiktionary']);
  });
});
describe('lookup',()=>{
  const fetcher=(known:Record<string,unknown>)=>async(url:string)=>known[url]??null;
  it('falls back to the base form, blends the thesaurus and reports the lemma',async()=>{
    const get=fetcher({[sources.free('run')]:[{word:'run',meanings:[{partOfSpeech:'verb',definitions:[{definition:'To move quickly.'}]}]}],[sources.synonyms('run')]:[{word:'sprint'},{word:'dash'}],[sources.antonyms('run')]:[{word:'walk'}]});
    const entry=await lookup('running',get);
    expect(entry).toMatchObject({word:'running',lemma:'run',synonyms:['sprint','dash'],antonyms:['walk']});
    expect(entry?.sources).toEqual(['Free Dictionary','Datamuse']);
  });
  it('lends an inflected entry the thesaurus of its base word',async()=>{
    const get=fetcher({[sources.free('ran')]:[{word:'ran',meanings:[{partOfSpeech:'verb',definitions:[{definition:'Simple past tense of run.'}]}]}],[sources.synonyms('run')]:[{word:'sprint'},{word:'ran'}]});
    const entry=await lookup('ran',get);
    expect(entry).toMatchObject({word:'ran',lemma:'run',synonyms:['sprint']});
    expect(baseForm({word:'x',meanings:[{partOfSpeech:'noun',senses:[{definition:'plural of cat'}]}],synonyms:[],antonyms:[],sources:[]})).toBe('cat');
    expect(baseForm({word:'x',meanings:[{partOfSpeech:'noun',senses:[{definition:'A large cat.'}]}],synonyms:[],antonyms:[],sources:[]})).toBeUndefined();
  });
  it('uses wiktionary alone for words the dictionary lacks',async()=>{
    const entry=await lookup('ephemeral',fetcher({[sources.wiktionary('ephemeral')]:wikt}));
    expect(entry?.sources).toEqual(['Wiktionary']);expect(entry?.meanings[0].senses[0].definition).toContain('short period');
  });
  it('returns a thesaurus-only entry, or null when nothing knows the word',async()=>{
    expect((await lookup('zzzq',fetcher({[sources.synonyms('zzzq')]:[{word:'zzz'}]})))?.meanings).toEqual([]);
    expect(await lookup('zzzq',fetcher({}))).toBeNull();
    expect(await lookup('!!!',fetcher({}))).toBeNull();
  });
});
