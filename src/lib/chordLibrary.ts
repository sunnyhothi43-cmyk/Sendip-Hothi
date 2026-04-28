
export interface ChordPosition {
  frets: number[]; // E A D G B E, -1 for muted, 0 for open
  fingers: number[]; // 0 for none, 1 index, 2 middle, 3 ring, 4 pinky
  barres?: number[]; // fret numbers where a barre starts
  baseFret?: number; // 1 by default
}

export interface ChordData {
  name: string;
  positions: ChordPosition[];
}

export const CHORD_LIBRARY: Record<string, ChordData> = {
  'C': {
    name: 'C',
    positions: [
      { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] }
    ]
  },
  'G': {
    name: 'G',
    positions: [
      { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
      { frets: [3, 2, 0, 0, 3, 3], fingers: [2, 1, 0, 0, 3, 4] }
    ]
  },
  'D': {
    name: 'D',
    positions: [
      { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] }
    ]
  },
  'A': {
    name: 'A',
    positions: [
      { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] }
    ]
  },
  'E': {
    name: 'E',
    positions: [
      { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] }
    ]
  },
  'F': {
    name: 'F',
    positions: [
      { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barres: [1] },
      { frets: [-1, -1, 3, 2, 1, 1], fingers: [0, 0, 3, 2, 1, 1] }
    ]
  },
  'B': {
    name: 'B',
    positions: [
      { frets: [-1, 2, 4, 4, 4, 2], fingers: [0, 1, 2, 3, 4, 1], barres: [2] }
    ]
  },
  'Am': {
    name: 'Am',
    positions: [
      { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] }
    ]
  },
  'Em': {
    name: 'Em',
    positions: [
      { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] }
    ]
  },
  'Dm': {
    name: 'Dm',
    positions: [
      { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] }
    ]
  },
  'Bm': {
    name: 'Bm',
    positions: [
      { frets: [-1, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1], barres: [2] }
    ]
  },
  'F#m': {
    name: 'F#m',
    positions: [
      { frets: [2, 4, 4, 2, 2, 2], fingers: [1, 3, 4, 1, 1, 1], barres: [2] }
    ]
  },
  'C7': {
    name: 'C7',
    positions: [
      { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] }
    ]
  },
  'G7': {
    name: 'G7',
    positions: [
      { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] }
    ]
  },
  'D7': {
    name: 'D7',
    positions: [
      { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] }
    ]
  },
  'A7': {
    name: 'A7',
    positions: [
      { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 1, 0, 2, 0] }
    ]
  },
  'E7': {
    name: 'E7',
    positions: [
      { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] }
    ]
  },
  'B7': {
    name: 'B7',
    positions: [
      { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] }
    ]
  },
  'Fmaj7': {
    name: 'Fmaj7',
    positions: [
      { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] }
    ]
  },
  'Cmaj7': {
    name: 'Cmaj7',
    positions: [
      { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] }
    ]
  },
  'Gmaj7': {
    name: 'Gmaj7',
    positions: [
      { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1] }
    ]
  },
  'Dsus4': {
    name: 'Dsus4',
    positions: [
      { frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 3, 4] }
    ]
  },
  'Asus4': {
    name: 'Asus4',
    positions: [
      { frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 4, 0] }
    ]
  },
  'Esus4': {
    name: 'Esus4',
    positions: [
      { frets: [0, 2, 2, 2, 0, 0], fingers: [0, 2, 3, 4, 0, 0] }
    ]
  },
  'Csus2': {
    name: 'Csus2',
    positions: [
      { frets: [-1, 3, 0, 0, 3, 3], fingers: [0, 1, 0, 0, 3, 4] }
    ]
  },
  'Asus2': {
    name: 'Asus2',
    positions: [
      { frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 2, 3, 0, 0] }
    ]
  }
};
