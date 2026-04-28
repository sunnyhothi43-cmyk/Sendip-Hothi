import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface SongData {
  title: string;
  artist: string;
  originalKey: string;
  suggestedTempo: number;
  sections: {
    name: string;
    lines: string[];
  }[];
}

export async function fetchSongData(songQuery: string): Promise<SongData> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Retrieve the COMPLETE guitar chords and lyrics for the song: "${songQuery}". 
      CRITICAL: Provide the ENTIRE song from start to finish. Include EVERY verse, chorus, bridge, and outro. 
      STRICT PROHIBITION: 
      - NO placeholders like "(Repeat Chorus)". 
      - NO truncated sections. 
      - NO summarizing. 
      If a chorus repeats 3 times, you MUST output the full chords and lyrics for all 3 occurrences.
      MANDATORY: Include chords for the Intro and any Instrumental sections (Solos/Outros). If no lyrics exist for a section, provide the chord progression in brackets (e.g., [G] [Em] [C] [D]).
      Place chords in brackets like [C] or [Am7] at the PRECISE column where the chord change occurs in the lyrics.
      Ensure the output is valid JSON according to the schema.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            artist: { type: Type.STRING },
            originalKey: { type: Type.STRING },
            suggestedTempo: { type: Type.NUMBER },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  lines: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["name", "lines"]
              }
            }
          },
          required: ["title", "artist", "originalKey", "suggestedTempo", "sections"]
        }
      }
    });

    const text = response?.text || "";
    if (!text) throw new Error("No data received from Gemini");
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Gemini fetchSongData error:", error);
    if (error?.status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("The AI service is currently busy. Please try again in a few moments.");
    }
    throw error;
  }
}

export async function searchSongs(query: string): Promise<{ title: string; artist: string }[]> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `The user searched for: "${query}". 
      Analyze this query and return a list of 8-12 relevant song matches.
      
      BE RELAXED AND HELPFUL:
      - If it's an artist name, return their top 10 acoustic/guitar-friendly hits.
      - If it's a song title, return the most likely version and similar/related songs.
      - If it's a genre or mood, return popular matches.
      - If there's a typo, try to guess what they meant.
      - Even if the query is vague, suggest popular guitar classics.
      
      Format the response as a JSON object with a "results" array. Each item must have "title" and "artist".`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            results: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  artist: { type: Type.STRING }
                },
                required: ["title", "artist"]
              }
            }
          },
          required: ["results"]
        }
      }
    });

    const text = response?.text || "";
    if (!text) return [];
    const data = JSON.parse(text);
    return data.results || [];
  } catch (error) {
    console.warn("Gemini searchSongs error:", error);
    return [];
  }
}

export async function fetchRecommendations(artists: string[]): Promise<{ title: string; artist: string }[]> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Based on these favorite artists: ${artists.join(", ")}, suggest 25 similar songs that are popular but also generally easy to play on acoustic guitar (basic open chords).
      Return a list of song objects with 'title' and 'artist' keys.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  artist: { type: Type.STRING }
                },
                required: ["title", "artist"]
              }
            }
          },
          required: ["recommendations"]
        }
      }
    });

    const text = response?.text || "";
    if (!text) return [];
    const data = JSON.parse(text);
    return data.recommendations || [];
  } catch (error: any) {
    console.warn("Gemini fetchRecommendations error:", error);
    return [];
  }
}

export async function fetchChordFingering(chord: string): Promise<{ frets: number[]; fingers: number[]; barres?: number[] } | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Provide the guitar fingering for the chord "${chord}" in standard tuning.
      Prioritize an easy-to-play open position if possible.
      Return the data in this JSON format: { "frets": [E, A, D, G, B, e], "fingers": [E, A, D, G, B, e], "barres": [] }.
      Use -1 for muted strings and 0 for open strings. Fingers are 1-4.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            frets: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            fingers: { type: Type.ARRAY, items: { type: Type.INTEGER } },
            barres: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          },
          required: ["frets", "fingers"],
        },
      },
    });

    const text = response?.text || "";
    if (!text) return null;
    const data = JSON.parse(text);
    return data;
  } catch (error) {
    console.error("Error fetching chord fingering:", error);
    return null;
  }
}
