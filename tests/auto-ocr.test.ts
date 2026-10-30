import {describe,it,expect} from 'vitest';
import {hasTextBands} from '../lib/readwind/auto-ocr';
function image(background=255){const width=200,height=300,data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=background;data[i+3]=255;}return {width,height,data};}
function text(img:ReturnType<typeof image>,color=0){for(const y of [45,70,95,120])for(let x=30;x<160;x+=7)for(let dx=0;dx<3;dx++)for(let dy=0;dy<4;dy++){const i=((y+dy)*img.width+x+dx)*4;img.data[i]=img.data[i+1]=img.data[i+2]=color;}return img;}
describe('automatic recognition detection',()=>{
 it('recognizes uncovered text bands in light, dark and faint scans',()=>{expect(hasTextBands(text(image()))).toBe(true);expect(hasTextBands(text(image(0),255))).toBe(true);expect(hasTextBands(text(image(),205))).toBe(true);});
 it('does not recognize blank pages, solid images or image noise as text pages',()=>{expect(hasTextBands(image())).toBe(false);expect(hasTextBands(image(35))).toBe(false);const photo=image();for(let i=0;i<photo.data.length;i+=4)photo.data[i]=photo.data[i+1]=photo.data[i+2]=(i/4*73)%256;expect(hasTextBands(photo)).toBe(false);});
 it('skips text already covered by a valid native layer but detects scan text above a footer',()=>{
  const img=text(image()),rects=[45,70,95,120].map(y=>({left:25,right:165,top:y-2,bottom:y+8}));expect(hasTextBands(img,rects)).toBe(false);expect(hasTextBands(img,[{left:85,right:110,top:270,bottom:290}])).toBe(true);
 });
 it('detects scanned text despite dark page borders and binding shadows',()=>{
  const img=text(image());for(let y=0;y<img.height;y++)for(const x of [...Array(20).keys(),...Array.from({length:15},(_,i)=>185+i)]){const p=(y*img.width+x)*4;img.data[p]=img.data[p+1]=img.data[p+2]=0;}
  expect(hasTextBands(img)).toBe(true);
 });
});
