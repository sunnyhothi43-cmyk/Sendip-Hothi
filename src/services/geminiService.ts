import { SongData } from './../types';

export { type SongData };

export async function fetchSongData(songQuery: string): Promise<SongData> {
  const response = await fetch('/api/song-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songQuery }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function searchSongs(query: string): Promise<{ title: string; artist: string }[]> {
  try {
    const response = await fetch('/api/search-songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) return [];
    return response.json();
  } catch (error) {
    console.warn('Error connecting to search proxy:', error);
    return [];
  }
}

export async function fetchRecommendations(artists: string[]): Promise<{ title: string; artist: string }[]> {
  try {
    const response = await fetch('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists }),
    });
    if (!response.ok) return [];
    return response.json();
  } catch (error) {
    console.warn('Error connecting to recommendations proxy:', error);
    return [];
  }
}

export async function fetchChordFingering(chord: string): Promise<{ frets: number[]; fingers: number[]; barres?: number[] } | null> {
  try {
    const response = await fetch('/api/chord-fingering', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chord }),
    });
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.warn('Error connecting to chord fingering proxy:', error);
    return null;
  }
}
