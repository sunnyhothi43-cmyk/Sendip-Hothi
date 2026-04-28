
export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const EASY_CHORDS = [
  'C', 'G', 'D', 'A', 'E', 'F', 'B',
  'Am', 'Em', 'Dm', 'Bm', 'F#m',
  'C7', 'G7', 'D7', 'A7', 'E7', 'B7',
  'Fmaj7', 'Cmaj7', 'Gmaj7',
  'Dsus4', 'Asus4', 'Esus4', 'Csus2', 'Asus2'
];

export function transposeChord(chord: string, semitones: number): string {
  if (semitones === 0) return chord;
  
  // Handle slash chords
  if (chord.includes('/')) {
    const [top, bottom] = chord.split('/');
    return `${transposeChord(top, semitones)}/${transposeChord(bottom, semitones)}`;
  }

  const chordRegex = /^([A-G][#b]?)(.*)$/;
  const match = chord.match(chordRegex);
  
  if (!match) return chord;
  
  const root = match[1];
  const extension = match[2];
  
  let index = NOTES.indexOf(root);
  if (index === -1) {
    index = FLAT_NOTES.indexOf(root);
  }
  
  if (index === -1) return chord;
  
  let newIndex = (index + semitones) % 12;
  while (newIndex < 0) newIndex += 12;
  
  // Choose between sharp or flat representation
  // For easy key calculation, we prefer the one that might be in EASY_CHORDS
  // but NOTES usually works fine.
  const newRoot = NOTES[newIndex];
  const newRootFlat = FLAT_NOTES[newIndex];

  // If the flat version is more common for this note (e.g., Bb vs A#), we might want to use it
  // But for simple transposition, stick to one.
  // Actually, let's keep it consistent with what we check in EASY_CHORDS.
  return newRoot + extension;
}

export function transposeLine(line: string, semitones: number): string {
  if (semitones === 0) return line;
  return line.replace(/\[([A-G][#b]?[^\]]*)\]/g, (match, chord) => {
    return `[${transposeChord(chord, semitones)}]`;
  });
}

export interface ChordSegment {
  chord?: string;
  text: string;
}

export function parseChordSegments(line: string): ChordSegment[] {
  const segments: ChordSegment[] = [];
  let i = 0;
  let currentSegment: ChordSegment = { text: '' };

  while (i < line.length) {
    if (line[i] === '[') {
      // If we already have text or a chord in the current segment, push it
      if (currentSegment.chord || currentSegment.text) {
        segments.push(currentSegment);
      }
      
      let chord = '';
      i++;
      while (i < line.length && line[i] !== ']') {
        chord += line[i];
        i++;
      }
      currentSegment = { chord, text: '' };
      i++; // skip ']'
    } else {
      currentSegment.text += line[i];
      i++;
    }
  }
  
  if (currentSegment.chord || currentSegment.text) {
    segments.push(currentSegment);
  }
  
  return segments;
}

export function getEasyKeyOffset(sections: { lines: string[] }[]): number {
  const chords = new Set<string>();
  sections.forEach(s => {
    s.lines.forEach(l => {
      const match = l.match(/\[([A-G][#b]?[^\]]*)\]/g);
      match?.forEach(m => chords.add(m.slice(1, -1)));
    });
  });

  if (chords.size === 0) return 0;

  let bestOffset = 0;
  let minDifficulty = Infinity;

  for (let offset = 0; offset < 12; offset++) {
    let difficulty = 0;
    chords.forEach(c => {
      const transposed = transposeChord(c, offset);
      
      // Check if it's a common novice chord
      // For difficulty, we check if the basic form (omitting extensions) is easy
      const base = transposed.split('/')[0].replace(/(m|maj|M|7|sus[24]|add[249])*$/, '');
      const isEasy = EASY_CHORDS.includes(transposed) || EASY_CHORDS.includes(base);
      
      if (!isEasy) {
        // High penalty for chords with # or b that aren't in EASY_CHORDS
        if (transposed.includes('#') || transposed.includes('b')) {
          difficulty += 3;
        } else {
          difficulty += 1;
        }
      }
    });

    if (difficulty < minDifficulty) {
      minDifficulty = difficulty;
      bestOffset = offset;
    }
  }

  return bestOffset;
}
