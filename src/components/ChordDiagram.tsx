import React from 'react';
import { ChordPosition } from '../lib/chordLibrary';

interface ChordDiagramProps {
  position: ChordPosition;
  size?: number;
  label?: string;
}

export const ChordDiagram: React.FC<ChordDiagramProps> = ({ position, size = 120, label }) => {
  const { frets, fingers, barres = [] } = position;
  const numFrets = 5;
  const numStrings = 6;
  const margin = 20;
  const gridWidth = size - margin * 2;
  const gridHeight = size - margin * 2;
  const stringSpacing = gridWidth / (numStrings - 1);
  const fretSpacing = gridHeight / numFrets;
  const dotRadius = stringSpacing * 0.35;
  const minFret = Math.min(...frets.filter(f => f > 0));
  const baseFret = position.baseFret ?? (minFret > 4 ? minFret : 1);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {label && <text x={size / 2} y={margin / 2} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#E0E0E0">{label}</text>}
      {baseFret === 1 && <rect x={margin} y={margin} width={gridWidth} height={3} fill="#E0E0E0" />}
      {baseFret > 1 && <text x={margin / 2} y={margin + fretSpacing / 2} textAnchor="middle" fontSize={12} fill="#E0E0E0">{baseFret}</text>}
      {Array.from({ length: numFrets + 1 }).map((_, i) => (
        <line key={`fret-${i}`} x1={margin} y1={margin + i * fretSpacing} x2={margin + gridWidth} y2={margin + i * fretSpacing} stroke="#555" strokeWidth={1} />
      ))}
      {Array.from({ length: numStrings }).map((_, i) => (
        <line key={`string-${i}`} x1={margin + i * stringSpacing} y1={margin} x2={margin + i * stringSpacing} y2={margin + gridHeight} stroke="#777" strokeWidth={1} />
      ))}
      {barres.map((fret, i) => {
        const relativeFret = fret - baseFret + 1;
        if (relativeFret < 1 || relativeFret > numFrets) return null;
        const y = margin + (relativeFret - 0.5) * fretSpacing;
        let first = -1, last = -1;
        for (let s = 0; s < 6; s++) { if (frets[s] === fret) { if (first === -1) first = s; last = s; } }
        if (first === -1) return null;
        return <rect key={`barre-${i}`} x={margin + first * stringSpacing - dotRadius} y={y - dotRadius / 2} width={(last - first) * stringSpacing + dotRadius * 2} height={dotRadius} rx={dotRadius / 2} fill="#F59E0B" />;
      })}
      {frets.map((fret, i) => {
        const x = margin + i * stringSpacing;
        if (fret === -1) return <text key={`mute-${i}`} x={x} y={margin - 6} textAnchor="middle" fontSize={12} fill="#E0E0E0">×</text>;
        if (fret === 0) return <circle key={`open-${i}`} cx={x} cy={margin - 6} r={3} stroke="#E0E0E0" strokeWidth={1} fill="none" />;
        return null;
      })}
      {frets.map((fret, i) => {
        if (fret <= 0) return null;
        const relativeFret = fret - baseFret + 1;
        if (relativeFret < 1 || relativeFret > numFrets) return null;
        const x = margin + i * stringSpacing;
        const y = margin + (relativeFret - 0.5) * fretSpacing;
        return (
          <g key={`dot-${i}`}>
            <circle cx={x} cy={y} r={dotRadius} fill="#F59E0B" />
            {fingers[i] > 0 && <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fill="#0F0F11">{fingers[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
};
