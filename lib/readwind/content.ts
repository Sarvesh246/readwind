import type { Block } from './types';

// Old imports stored this UI message as a paragraph. Keep block indexes intact:
// annotations, print-page marks and cross-device positions refer to those indexes.
export function hasReadableContent(block: Block) {
  return block.type === 'figure' || !!block.text.trim() &&
    block.text.trim() !== '[No readable text was detected on this page. See the original PDF.]';
}
