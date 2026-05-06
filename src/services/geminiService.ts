import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export interface SongData {
  title: string;
  artist: string;
  originalKey: string;
  suggestedTempo: number;
  strummingPattern?: string;
  sections: {
    name: string;
    lines: string[];
  }[];
}

export async function fetchSongData(songQuery: string): Promise<SongData> {
  try {
    const model = ai.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING },
            artist: { type: SchemaType.STRING },
            originalKey: { type: SchemaType.STRING },
            suggestedTempo: { type: SchemaType.NUMBER },
            strummingPattern: { type: SchemaType.STRING },
            sections: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  lines: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING }
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

    const response = await model.generateContent(`Retrieve the COMPLETE guitar chords and lyrics for the song: "${songQuery}". 
    CRITICAL: Provide the ENTIRE song from start to finish. Include EVERY verse, chorus, bridge, and outro. 
    STRICT PROHIBITION: 
    - NO placeholders like "(Repeat Chorus)". 
    - NO truncated sections. 
    - NO summarizing. 
    If a chorus repeats 3 times, you MUST output the full chords and lyrics for all 3 occurrences.
    MANDATORY: Include chords for the Intro and any Instrumental sections (Solos/Outros). If no lyrics exist for a section, provide the chord progression in brackets (e.g., [G] [Em] [C] [D]).
    Place chords in brackets like [C] or [Am7] at the PRECISE column where the chord change occurs in the lyrics.
    NEW MANDATORY: Provide a recommended strumming pattern for this song (e.g., "D-D-U-U-D-U" or "4/4 Downstrokes only").
    Ensure the output is valid JSON according to the schema.`);

    const text = response.response.text();
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
    const model = ai.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            results: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  title: { type: SchemaType.STRING },
                  artist: { type: SchemaType.STRING }
                },
                required: ["title", "artist"]
              }
            }
          },
          required: ["results"]
        }
      }
    });

    const response = await model.generateContent(`The user searched for: "${query}". 
    Analyze this query and return a list of 8-12 relevant song matches.
    
    BE RELAXED AND HELPFUL:
    - If it's an artist name, return their top 10 acoustic/guitar-friendly hits.
    - If it's a song title, return the most likely version and similar/related songs.
    - If it's a genre or mood, return popular matches.
    - If there's a typo, try to guess what they meant.
    - Even if the query is vague, suggest popular guitar classics.
    
    Format the response as a JSON object with a "results" array. Each item must have "title" and "artist".`);

    const text = response.response.text();
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
    const model = ai.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            recommendations: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  title: { type: SchemaType.STRING },
                  artist: { type: SchemaType.STRING }
                },
                required: ["title", "artist"]
              }
            }
          },
          required: ["recommendations"]
        }
      }
    });

    const response = await model.generateContent(`Based on these favorite artists: ${artists.join(", ")}, suggest 25 similar songs that are popular but also generally easy to play on acoustic guitar (basic open chords).
    Return a list of song objects with 'title' and 'artist' keys.`);

    const text = response.response.text();
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
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
    const response = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: `Provide the guitar fingering for the chord "${chord}" in standard tuning.
      Prioritize an easy-to-play open position if possible.
      Return the data in this JSON format: { "frets": [E, A, D, G, B, e], "fingers": [E, A, D, G, B, e], "barres": [] }.
      Use -1 for muted strings and 0 for open strings. Fingers are 1-4.` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            frets: { type: SchemaType.ARRAY, items: { type: SchemaType.INTEGER } },
            fingers: { type: SchemaType.ARRAY, items: { type: SchemaType.INTEGER } },
            barres: { type: SchemaType.ARRAY, items: { type: SchemaType.INTEGER } },
          },
          required: ["frets", "fingers"],
        },
      },
    });

    const text = response.response.text();
    if (!text) return null;
    const data = JSON.parse(text);
    return data;
  } catch (error) {
    console.error("Error fetching chord fingering:", error);
    return null;
  }
}
