import express from 'express';
import { createServer as createViteServer } from 'vite';
import Stripe from 'stripe';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is required.');
  if (!key.startsWith('sk_')) throw new Error('STRIPE_SECRET_KEY must start with "sk_".');
  if (key.includes('...') || key.includes('***')) throw new Error('STRIPE_SECRET_KEY appears truncated.');
  if (!stripeClient) stripeClient = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
  return stripeClient;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface SongData {
  title: string;
  artist: string;
  originalKey: string;
  suggestedTempo: number;
  strummingPattern?: string;
  sections: { name: string; lines: string[] }[];
}

async function geminiFetchSongData(songQuery: string): Promise<SongData> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash-latest',
    contents: `Retrieve the COMPLETE guitar chords and lyrics for: "${songQuery}". Return valid JSON with schema.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          artist: { type: Type.STRING },
          originalKey: { type: Type.STRING },
          suggestedTempo: { type: Type.NUMBER },
          strummingPattern: { type: Type.STRING },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                lines: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ['name', 'lines']
            }
          }
        },
        required: ['title', 'artist', 'originalKey', 'suggestedTempo', 'sections']
      }
    }
  });
  const text = response?.text ?? '';
  if (!text) throw new Error('No data received from Gemini');
  return JSON.parse(text);
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  app.use(express.json());

  app.get('/health', (_req, res) => res.status(200).send('OK'));

  app.post('/api/gemini/song', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });
    try {
      const data = await geminiFetchSongData(query);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
