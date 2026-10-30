const languages=[['eng','English'],['spa','Spanish'],['fra','French'],['deu','German'],['por','Portuguese'],['hin','Hindi'],['ara','Arabic'],['jpn','Japanese'],['chi_sim','Chinese (simplified)']];
export function OcrLanguages({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){
 const selected=value.split('+');
 return <fieldset className="ocr-languages" disabled={disabled}><legend>OCR languages</legend><div>{languages.map(([id,name])=><label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={e=>{const next=e.target.checked?[...selected,id]:selected.filter(x=>x!==id);onChange(next.length?next.join('+'):'eng');}}/>{name}</label>)}</div><small>Select all languages used in the book. More languages can increase recognition time; unsupported scripts remain readable in the original page.</small></fieldset>;
}
