
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
  
  // Calculate the starting fret
  const minFret = Math.min(...frets.filter(f => f > 0));
  const baseFret = position.baseFret || (minFret > 4 ? minFret : 1);

  return (
    <div className="flex flex-col items-center">
      {label && <div className="text-[10px] font-bold mb-1 uppercase tracking-wider text-neutral-400">{label}</div>}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="bg-neutral-900/50 rounded-lg p-2 border border-neutral-800">
        {/* Nut (if baseFret is 1) */}
        {baseFret === 1 && (
          <line 
            x1={margin} y1={margin} 
            x2={size - margin} y2={margin} 
            stroke="white" strokeWidth="3" 
          />
        )}
        
        {/* Base Fret Number */}
        {baseFret > 1 && (
          <text 
            x={margin - 10} y={margin + fretSpacing * 0.5 + 4} 
            fontSize="10" fill="#888" textAnchor="middle"
          >
            {baseFret}
          </text>
        )}

        {/* Frets */}
        {Array.from({ length: numFrets + 1 }).map((_, i) => (
          <line 
            key={`fret-${i}`}
            x1={margin} y1={margin + i * fretSpacing} 
            x2={size - margin} y2={margin + i * fretSpacing} 
            stroke="#333" strokeWidth="1" 
          />
        ))}

        {/* Strings */}
        {Array.from({ length: numStrings }).map((_, i) => (
          <line 
            key={`string-${i}`}
            x1={margin + i * stringSpacing} y1={margin} 
            x2={margin + i * stringSpacing} y2={size - margin} 
            stroke="#444" strokeWidth={1 + i * 0.2} 
          />
        ))}

        {/* Barres */}
        {barres.map((fret, i) => {
          const relativeFret = fret - baseFret + 1;
          if (relativeFret < 1 || relativeFret > numFrets) return null;
          
          const y = margin + (relativeFret - 0.5) * fretSpacing;
          
          // Find first and last string for this barre
          let first = -1, last = -1;
          for (let s = 0; s < 6; s++) {
            if (frets[s] === fret) {
              if (first === -1) first = s;
              last = s;
            }
          }
          
          if (first === -1) return null;

          return (
            <rect 
              key={`barre-${i}`}
              x={margin + first * stringSpacing - dotRadius}
              y={y - dotRadius}
              width={(last - first) * stringSpacing + dotRadius * 2}
              height={dotRadius * 2}
              rx={dotRadius}
              fill="#555"
            />
          );
        })}

        {/* Muted / Open Indicators */}
        {frets.map((fret, i) => {
          const x = margin + i * stringSpacing;
          if (fret === -1) {
            return (
              <g key={`muted-${i}`} stroke="#888" strokeWidth="1.5">
                <line x1={x - 3} y1={margin - 8} x2={x + 3} y2={margin - 2} />
                <line x1={x + 3} y1={margin - 8} x2={x - 3} y2={margin - 2} />
              </g>
            );
          }
          if (fret === 0) {
            return (
              <circle 
                key={`open-${i}`}
                cx={x} cy={margin - 5} r="3" 
                fill="none" stroke="#888" strokeWidth="1" 
              />
            );
          }
          return null;
        })}

        {/* Fingering Dots */}
        {frets.map((fret, i) => {
          if (fret <= 0) return null;
          
          const relativeFret = fret - baseFret + 1;
          if (relativeFret < 1 || relativeFret > numFrets) return null;
          
          const x = margin + i * stringSpacing;
          const y = margin + (relativeFret - 0.5) * fretSpacing;
          
          return (
            <g key={`finger-${i}`}>
              <circle cx={x} cy={y} r={dotRadius} fill="white" />
              {fingers[i] > 0 && (
                <text x={x} y={y + 3} fontSize="8" fill="black" textAnchor="middle" fontWeight="bold">
                  {fingers[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
