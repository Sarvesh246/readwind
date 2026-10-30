import type {Block} from './types';
import type {CSSProperties} from 'react';
/** Shared by the measuring DOM and both readers so pagination matches presentation. */
export function blockLayout(block:Block):CSSProperties{
 if(block.type==='figure' || !block.layout)return {};
 return {whiteSpace:'pre-wrap' as const,textAlign:'start' as const,textIndent:'0',hyphens:'none' as const,...(block.layout==='code'?{fontFamily:'ui-monospace, SFMono-Regular, Consolas, monospace',fontVariantNumeric:'normal' as const}:{}),marginBlock:'.4em'};
}
