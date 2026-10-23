const compact = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const sentences = text => text.match(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/gu) || [text];

export function repeatsSpeech(spoken, visible) {
  const a = compact(spoken), b = compact(visible);
  if (!a || !b) return false;
  if ((a.match(/\d+/gu) || []).join() !== (b.match(/\d+/gu) || []).join()) return false;
  if (a === b || a.length >= 6 && b.includes(a)) return true;
  if (Math.min(a.length, b.length) < 8 || Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.75) return false;
  const grams = text => new Set(Array.from({ length: text.length - 2 }, (_, index) => text.slice(index, index + 3)));
  const left = grams(a), right = grams(b);
  return 2 * [...left].filter(gram => right.has(gram)).length / (left.size + right.size) >= 0.82;
}

// Do not generate another model request just to rephrase the same sentence.
// Optional repeats stay as text; explicitly requested repeats move to voice.
export function independentSpeech(rows, voices, required) {
  for (const [index, voice] of voices.entries()) {
    if (!voice.text) continue;
    const repeated = repeatsSpeech(voice.text, rows.map(row => row.text).join('')) || rows.some(row => repeatsSpeech(voice.text, row.text) || sentences(row.text).some(sentence => repeatsSpeech(voice.text, sentence)));
    if (!repeated) continue;
    if (!required) { voices[index] = { text: '', style: '' }; continue; }
    for (const row of rows) {
      // Keep any distinct text that the spoken sentence does not cover.
      const spoken = compact(voice.text), visible = compact(row.text);
      if (visible && (spoken.includes(visible) || repeatsSpeech(voice.text, row.text) && visible.length <= spoken.length * 1.25)) row.text = '';
      else row.text = sentences(row.text).filter(sentence => {
        const value = compact(sentence);
        return !value || !(spoken.includes(value) || repeatsSpeech(voice.text, sentence) && value.length <= spoken.length * 1.25);
      }).join('').trim();
    }
  }
}
