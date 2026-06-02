var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_vite = require("vite");
var import_stripe = __toESM(require("stripe"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_genai = require("@google/genai");
import_dotenv.default.config();
var currentKey = null;
var stripeClient = null;
var aiClient = null;
function getGemini() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please check your system configuration.");
    }
    aiClient = new import_genai.GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return aiClient;
}
function getSanitizedKey() {
  const rawKey = process.env.STRIPE_SECRET_KEY;
  if (!rawKey) {
    throw new Error("STRIPE_SECRET_KEY environment variable is required. Please add it in the Settings menu.");
  }
  return rawKey.trim().replace(/^["'](.+)["']$/, "$1").trim();
}
function getStripe() {
  const key = getSanitizedKey();
  const isTruncated = key.includes("...") || key.includes("***") || key.includes("\u2026");
  if (isTruncated || !key.startsWith("sk_")) {
    stripeClient = new import_stripe.default(key, { apiVersion: "2024-12-18.acacia" });
    currentKey = key;
  } else if (key !== currentKey || !stripeClient) {
    stripeClient = new import_stripe.default(key, {
      apiVersion: "2024-12-18.acacia"
    });
    currentKey = key;
  }
  return stripeClient;
}
function checkStripeKey(key) {
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is missing. Please add it in the Settings menu.");
  }
  const sanitized = key.trim().replace(/^["'](.+)["']$/, "$1").trim();
  const isTruncated = sanitized.includes("...") || sanitized.includes("***") || sanitized.includes("\u2026");
  if (sanitized === "Nil" || sanitized === "NULL" || sanitized === "UNDEFINED") {
    throw new Error(`STRIPE_SECRET_KEY is set to "${sanitized}". This is usually a placeholder. Please go to Settings -> Environment Variables and paste your real "sk_live_..." key.`);
  }
  if (isTruncated) {
    const start = sanitized.substring(0, 12);
    const end = sanitized.substring(sanitized.length - 4);
    console.error(`Stripe Key Rejected: Length=${sanitized.length}, Start=${start}, End=${end}`);
    throw new Error(`STRIPE_SECRET_KEY is truncated (contains "..." or "***"). In Stripe Dashboard, you MUST click "Reveal live key" then CLICK the key text itself to copy the FULL value. (Current snippet: ${start}...${end})`);
  }
  if (!sanitized.startsWith("sk_")) {
    const prefix = sanitized.substring(0, 8);
    throw new Error(`STRIPE_SECRET_KEY is invalid (should start with "sk_"). Your key starts with "${prefix}". Please go to Stripe Dashboard -> API Keys and copy the "Secret key" (sk_...), NOT the "Publishable key" (pk_...).`);
  }
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  console.log(`[SERVER] Starting server. process.env.NODE_ENV is: "${process.env.NODE_ENV}"`);
  app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url} - IP: ${req.ip} - User-Agent: ${req.headers["user-agent"]}`);
    next();
  });
  app.use(import_express.default.json());
  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });
  app.get("/api/stripe-config", (req, res) => {
    const key = process.env.STRIPE_SECRET_KEY;
    const sanitized = key ? key.trim().replace(/^["'](.+)["']$/, "$1").trim() : "";
    res.json({
      hasSecretKey: !!key && sanitized !== "" && sanitized !== "Nil",
      secretKeyPrefix: sanitized.substring(0, 7),
      secretKeyLength: sanitized.length,
      isTruncated: sanitized.includes("...") || sanitized.includes("***") || sanitized.includes("\u2026"),
      isSkPrefix: sanitized.startsWith("sk_"),
      publishableKey: process.env.VITE_STRIPE_PUBLISHABLE_KEY || "Not Set",
      priceIds: {
        monthly: process.env.VITE_STRIPE_MONTHLY_PRICE_ID || "",
        yearly: process.env.VITE_STRIPE_YEARLY_PRICE_ID || "",
        lifetime: process.env.VITE_STRIPE_LIFETIME_PRICE_ID || ""
      }
    });
  });
  app.post("/api/song-data", async (req, res) => {
    const { songQuery } = req.body;
    if (!songQuery) {
      return res.status(400).json({ error: "Missing songQuery parameter" });
    }
    try {
      const ai = getGemini();
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Retrieve the COMPLETE guitar chords and lyrics for the song: "${songQuery}". 
        CRITICAL: Provide the ENTIRE song from start to finish. Include EVERY verse, chorus, bridge, outro, and instrumental section.
        STRICT PROHIBITION: 
        - NEVER abbreviate, summarize, or truncate any parts.
        - NEVER use placeholders like "(Repeat Chorus)", "(Chorus 1x)", etc.
        - NEVER omit repeating sections. If the Chorus is sung 3 times, you MUST output the full chords and lyrics for ALL 3 occurrences separately.
        - NEVER leave section lists empty. Every named section must have full lyric lines with chords.
        MANDATORY: 
        - Include chords for the Intro and any Instrumental sections (Solos/Outros). If no lyrics exist for a section, provide the chord progression in brackets (e.g. "[G] [Em] [C] [D]" as lines).
        - Place chords in brackets like [C] or [Am7] at the PRECISE column where the chord change occurs in the lyrics.
        - Include a "strummingPattern" as a string using D, U, and - (e.g., "D-D-DU-DU" or "D---D---DU-U-DU-U").
        Ensure the output is valid JSON according to the schema.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              title: { type: import_genai.Type.STRING },
              artist: { type: import_genai.Type.STRING },
              originalKey: { type: import_genai.Type.STRING },
              suggestedTempo: { type: import_genai.Type.NUMBER },
              strummingPattern: { type: import_genai.Type.STRING },
              sections: {
                type: import_genai.Type.ARRAY,
                items: {
                  type: import_genai.Type.OBJECT,
                  properties: {
                    name: { type: import_genai.Type.STRING },
                    lines: {
                      type: import_genai.Type.ARRAY,
                      items: { type: import_genai.Type.STRING }
                    }
                  },
                  required: ["name", "lines"]
                }
              }
            },
            required: ["title", "artist", "originalKey", "suggestedTempo", "sections", "strummingPattern"]
          }
        }
      });
      const text = response?.text || "";
      if (!text) throw new Error("No data received from Gemini");
      res.json(JSON.parse(text));
    } catch (error) {
      console.error("Gemini /api/song-data error:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/search-songs", async (req, res) => {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }
    try {
      const ai = getGemini();
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
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
            type: import_genai.Type.OBJECT,
            properties: {
              results: {
                type: import_genai.Type.ARRAY,
                items: {
                  type: import_genai.Type.OBJECT,
                  properties: {
                    title: { type: import_genai.Type.STRING },
                    artist: { type: import_genai.Type.STRING }
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
      if (!text) return res.json([]);
      const data = JSON.parse(text);
      res.json(data.results || []);
    } catch (error) {
      console.warn("Gemini /api/search-songs error:", error);
      res.json([]);
    }
  });
  app.post("/api/recommendations", async (req, res) => {
    const { artists } = req.body;
    if (!artists || !Array.isArray(artists)) {
      return res.status(400).json({ error: "Missing artists list" });
    }
    try {
      const ai = getGemini();
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Based on these favorite artists: ${artists.join(", ")}, suggest 25 similar songs that are popular but also generally easy to play on acoustic guitar (basic open chords).
        Return a list of song objects with 'title' and 'artist' keys.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              recommendations: {
                type: import_genai.Type.ARRAY,
                items: {
                  type: import_genai.Type.OBJECT,
                  properties: {
                    title: { type: import_genai.Type.STRING },
                    artist: { type: import_genai.Type.STRING }
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
      if (!text) return res.json([]);
      const data = JSON.parse(text);
      res.json(data.recommendations || []);
    } catch (error) {
      console.warn("Gemini /api/recommendations error:", error);
      res.json([]);
    }
  });
  app.post("/api/chord-fingering", async (req, res) => {
    const { chord } = req.body;
    if (!chord) {
      return res.status(400).json({ error: "Missing chord parameter" });
    }
    try {
      const ai = getGemini();
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Provide the guitar fingering for the chord "${chord}" in standard tuning.
        Prioritize an easy-to-play open position if possible.
        Return the data in this JSON format: { "frets": [E, A, D, G, B, e], "fingers": [E, A, D, G, B, e], "barres": [] }.
        Use -1 for muted strings and 0 for open strings. Fingers are 1-4.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              frets: { type: import_genai.Type.ARRAY, items: { type: import_genai.Type.INTEGER } },
              fingers: { type: import_genai.Type.ARRAY, items: { type: import_genai.Type.INTEGER } },
              barres: { type: import_genai.Type.ARRAY, items: { type: import_genai.Type.INTEGER } }
            },
            required: ["frets", "fingers"]
          }
        }
      });
      const text = response?.text || "";
      if (!text) return res.json(null);
      res.json(JSON.parse(text));
    } catch (error) {
      console.error("Gemini /api/chord-fingering error:", error);
      res.json(null);
    }
  });
  app.post("/api/feedback-chat", async (req, res) => {
    const { message, category, docId } = req.body;
    try {
      const ai = getGemini();
      const systemPrompt = `You are the Chordstream Supportive Developer Advocate AI Agent. 
      Your primary duty is to listen to the user's software feedback, bug reports, feature requests, or song requests regarding Chordstream (the hands-free guitar songbook app with key transpositions and chord placement).
      
      Currently, the user's message is being logged with Category: "${category || "general"}".
      ${docId ? `Perfect! This ticket is logged successfully in Firestore under Document ID: "${docId}".` : `We are running locally; the feedback will be saved to their account.`}

      BE SURE TO EXPLAIN CLEARLY OF THE FLOW:
      1. Their feedback is now permanently recorded in our Firestore database.
      2. Sunny (our active AI Coding Agent inside Google AI Studio) monitors this collection in real-time.
      3. Once Sunny notices a bug sheet or request, Sunny writes physical code fixes to correct the errors, checks the app builds, and pushes a commit directly to GitHub.
      4. GitHub Actions immediately builds the new Android bundle (AAB/APK) from the master branch ready for Google Play Store delivery.

      Be warm, helpful, positive, and technically reassuring. Answer any guitar, chords, transposition, or software troubleshooting questions they have eloquently. Keep formatting clean.`;
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          { text: `User message: "${message}"
Category: "${category || "general"}"` }
        ],
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.7
        }
      });
      const text = response?.text || "Your feedback was logged. Our engineering team is on manual review!";
      res.json({ text });
    } catch (error) {
      console.error("Gemini /api/feedback-chat error:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/create-checkout-session", async (req, res) => {
    const { priceId, userId, successUrl, cancelUrl } = req.body;
    if (!priceId || !userId) {
      return res.status(400).json({ error: "Missing priceId or userId" });
    }
    try {
      const stripe = getStripe();
      checkStripeKey(process.env.STRIPE_SECRET_KEY || "");
      if (priceId) {
        if (priceId.startsWith("http") || priceId.includes("buy.stripe.com")) {
          return res.status(400).json({
            error: `Invalid Price ID: "${priceId}". You have provided a Stripe Payment Link URL instead of a Price ID. Please go to Stripe Dashboard -> Product Catalog, click your product, and copy the "API ID" (starts with price_...).`
          });
        }
        if (priceId.startsWith("prod_")) {
          return res.status(400).json({
            error: `Invalid Price ID: "${priceId}". You have provided a Product ID (prod_...) instead of a Price ID. Please go to your Product Catalog in Stripe, click into the product, and copy the "API ID" from the 'Pricing' section (starts with price_...).`
          });
        }
      }
      const isLifetime = priceId === process.env.VITE_STRIPE_LIFETIME_PRICE_ID;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        mode: isLifetime ? "payment" : "subscription",
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        metadata: {
          userId
        }
      });
      res.json({ url: session.url });
    } catch (error) {
      console.error("Stripe error:", error);
      if (error.type === "StripeAuthenticationError") {
        return res.status(401).json({
          error: "Invalid Stripe API Key. Please verify your STRIPE_SECRET_KEY in the Settings menu."
        });
      }
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/create-portal-session", async (req, res) => {
    const { userId, returnUrl } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    try {
      const stripe = getStripe();
      checkStripeKey(process.env.STRIPE_SECRET_KEY || "");
      const customers = await stripe.customers.search({
        query: `metadata['userId']:'${userId}'`
      });
      if (customers.data.length === 0) {
        return res.status(404).json({
          error: "No active subscription found. You must complete a checkout first to access the Billing portal."
        });
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customers.data[0].id,
        return_url: returnUrl || "http://localhost:3000"
      });
      res.json({ url: portalSession.url });
    } catch (error) {
      console.error("Portal error:", error);
      if (error.type === "StripeAuthenticationError") {
        return res.status(401).json({
          error: "Invalid Stripe API Key. Please verify your STRIPE_SECRET_KEY in the Settings menu."
        });
      }
      res.status(500).json({ error: error.message });
    }
  });
  const distPath = import_path.default.join(process.cwd(), "dist");
  const hasBuild = import_fs.default.existsSync(import_path.default.join(distPath, "index.html"));
  const entryScript = process.argv[1] || "";
  const isDevMode = process.env.NODE_ENV !== "production" || entryScript.endsWith(".ts") || !entryScript.includes("dist");
  if (isDevMode || !hasBuild) {
    console.log("[SERVER] Mounting Vite dev middleware for live compilation.");
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    console.log(`[SERVER] Running in PRODUCTION mode. Serving static assets from: ${distPath}`);
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      console.log(`[ROUTE fallback] Sending ${import_path.default.join(distPath, "index.html")} for request: ${req.url}`);
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
