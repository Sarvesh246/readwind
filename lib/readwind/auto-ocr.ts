/** Detect repeated text-like ink bands without loading the recognition engine. */
export function hasTextBands(image:{width:number;height:number;data:ArrayLike<number>},covered:{left:number;top:number;right:number;bottom:number}[]=[]){
 const {width,height,data}=image,histogram=new Uint32Array(32);
 for(let i=0;i<data.length;i+=4){const a=data[i+3]/255,gray=(.299*data[i]+.587*data[i+1]+.114*data[i+2])*a+255*(1-a);histogram[Math.min(31,Math.floor(gray/8))]++;}
 let mode=0;for(let i=1;i<32;i++)if(histogram[i]>histogram[mode])mode=i;
 const background=mode*8+4,total=width*height;
 if(histogram[mode]/Math.max(1,total)<.3)return false;
 const columns=new Uint32Array(width);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,a=data[i+3]/255,gray=(.299*data[i]+.587*data[i+1]+.114*data[i+2])*a+255*(1-a);
  if(Math.abs(gray-background)>32)columns[x]++;
 }
 const rows:boolean[]=[];
 for(let y=0;y<height;y++){
  let ink=0,left=width,right=0;
  const native=covered.filter(r=>y>=r.top&&y<=r.bottom);
  for(let x=0;x<width;x++){
   // Persistent dark columns are usually scan borders or binding shadows, not letters.
   if(columns[x]>height*.8)continue;
   if(native.some(r=>x>=r.left&&x<=r.right))continue;
   const i=(y*width+x)*4,a=data[i+3]/255,gray=(.299*data[i]+.587*data[i+1]+.114*data[i+2])*a+255*(1-a);
   if(Math.abs(gray-background)>32){ink++;left=Math.min(left,x);right=x;}
  }
  rows.push(ink>=Math.max(3,width*.008) && ink<width*.4 && right-left>width*.12);
 }
 let bands=0,start=-1;
 for(let y=0;y<=height;y++){
  if(rows[y] && start<0)start=y;
  if(!rows[y] && start>=0){const h=y-start;if(h>=2 && h<=Math.max(8,height*.06))bands++;start=-1;}
 }
 return bands>=3;
}
