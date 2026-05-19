import { SongData } from './geminiService';

const API_BASE = '';

export async function fetchSongData(songQuery: string): Promise<SongData> {
  const res = await fetch(`${API_BASE}/api/gemini/song`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: songQuery }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return res.json();
}

export async function searchSongs(query: string): Promise<{ title: string; artist: string }[]> {
  const res = await fetch(`${API_BASE}/api/gemini/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) { console.warn('Search failed:', res.status); return []; }
  const data = await res.json();
  return data.results ?? [];
}

export async function fetchRecommendations(artists: string[]): Promise<{ title: string; artist: string }[]> {
  const res = await fetch(`${API_BASE}/api/gemini/recommendations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artists }),
  });
  if (!res.ok) { console.warn('Recommendations failed:', res.status); return []; }
  const data = await res.json();
  return data.recommendations ?? [];
}

export async function fetchChordFingering(chord: string): Promise<{ frets: number[]; fingers: number[]; barres?: number[] } | null> {
  console.warn(`fetchChordFingering("${chord}") not implemented.`);
  return null;
}
