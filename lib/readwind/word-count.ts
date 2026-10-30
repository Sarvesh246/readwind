const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
let segmenter:Intl.Segmenter|undefined;
/** Spaces do not delimit words in Japanese/Chinese; use Unicode word segmentation. */
export function readingWordCount(text:string){
 if(!text.trim())return 0;
 if(!cjk.test(text))return text.trim().split(/\s+/).length;
 if(typeof Intl.Segmenter==='function'){
  segmenter ||= new Intl.Segmenter(undefined,{granularity:'word'});
  let count=0;for(const part of segmenter.segment(text))if(part.isWordLike)count++;return count;
 }
 // Older engines can still learn a character-based pace instead of treating a page as one word.
 return (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+/gu)||[]).length;
}
