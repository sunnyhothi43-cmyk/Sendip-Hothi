import express from 'express';
import { createServer as createViteServer } from 'vite';
import Stripe from 'stripe';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

let currentKey: string | null = null;
let stripeClient: Stripe | null = null;

function getSanitizedKey(): string {
  const rawKey = process.env.STRIPE_SECRET_KEY;
  if (!rawKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required. Please add it in the Settings menu.');
  }
  return rawKey.trim().replace(/^["'](.+)["']$/, '$1').trim();
}

function getStripe(): Stripe {
  const key = getSanitizedKey();

  // Stripe secret keys usually start with sk_test_ or sk_live_
  const isTruncated = key.includes('...') || key.includes('***') || key.includes('…');
  
  if (isTruncated || !key.startsWith('sk_')) {
    // Create a temporary client to avoid crashing, but it will fail on use
    stripeClient = new Stripe(key, { apiVersion: '2024-12-18.acacia' as any });
    currentKey = key;
  } else if (key !== currentKey || !stripeClient) {
    stripeClient = new Stripe(key, {
      apiVersion: '2024-12-18.acacia' as any,
    });
    currentKey = key;
  }
  return stripeClient;
}

function checkStripeKey(key: string | undefined) {
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is missing. Please add it in the Settings menu.');
  }
  const sanitized = key.trim().replace(/^["'](.+)["']$/, '$1').trim();
  const isTruncated = sanitized.includes('...') || sanitized.includes('***') || sanitized.includes('…');
  
  if (sanitized === 'Nil' || sanitized === 'NULL' || sanitized === 'UNDEFINED') {
    throw new Error(`STRIPE_SECRET_KEY is set to "${sanitized}". This is usually a placeholder. Please go to Settings -> Environment Variables and paste your real "sk_live_..." key.`);
  }

  if (isTruncated) {
    const start = sanitized.substring(0, 12);
    const end = sanitized.substring(sanitized.length - 4);
    console.error(`Stripe Key Rejected: Length=${sanitized.length}, Start=${start}, End=${end}`);
    throw new Error(`STRIPE_SECRET_KEY is truncated (contains "..." or "***"). In Stripe Dashboard, you MUST click "Reveal live key" then CLICK the key text itself to copy the FULL value. (Current snippet: ${start}...${end})`);
  }
  
  if (!sanitized.startsWith('sk_')) {
    const prefix = sanitized.substring(0, 8);
    throw new Error(`STRIPE_SECRET_KEY is invalid (should start with "sk_"). Your key starts with "${prefix}". Please go to Stripe Dashboard -> API Keys and copy the "Secret key" (sk_...), NOT the "Publishable key" (pk_...).`);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Get Stripe Config Status
  app.get('/api/stripe-config', (req, res) => {
    const key = process.env.STRIPE_SECRET_KEY;
    const sanitized = key ? key.trim().replace(/^["'](.+)["']$/, '$1').trim() : '';
    
    res.json({
      hasSecretKey: !!key && sanitized !== '' && sanitized !== 'Nil',
      secretKeyPrefix: sanitized.substring(0, 7),
      secretKeyLength: sanitized.length,
      isTruncated: sanitized.includes('...') || sanitized.includes('***') || sanitized.includes('…'),
      isSkPrefix: sanitized.startsWith('sk_'),
      publishableKey: process.env.VITE_STRIPE_PUBLISHABLE_KEY || 'Not Set',
      priceIds: {
        monthly: process.env.VITE_STRIPE_MONTHLY_PRICE_ID || '',
        yearly: process.env.VITE_STRIPE_YEARLY_PRICE_ID || '',
        lifetime: process.env.VITE_STRIPE_LIFETIME_PRICE_ID || '',
      }
    });
  });

  // API Route: Create Checkout Session
  app.post('/api/create-checkout-session', async (req, res) => {
    const { priceId, userId, successUrl, cancelUrl } = req.body;

    if (!priceId || !userId) {
      return res.status(400).json({ error: 'Missing priceId or userId' });
    }

    try {
      const stripe = getStripe();
      checkStripeKey(process.env.STRIPE_SECRET_KEY || '');

      // Check if priceId is accidentally a URL or a Product ID
      if (priceId) {
        if (priceId.startsWith('http') || priceId.includes('buy.stripe.com')) {
          return res.status(400).json({ 
            error: `Invalid Price ID: "${priceId}". You have provided a Stripe Payment Link URL instead of a Price ID. Please go to Stripe Dashboard -> Product Catalog, click your product, and copy the "API ID" (starts with price_...).` 
          });
        }
        if (priceId.startsWith('prod_')) {
          return res.status(400).json({ 
            error: `Invalid Price ID: "${priceId}". You have provided a Product ID (prod_...) instead of a Price ID. Please go to your Product Catalog in Stripe, click into the product, and copy the "API ID" from the 'Pricing' section (starts with price_...).` 
          });
        }
      }

      const isLifetime = priceId === process.env.VITE_STRIPE_LIFETIME_PRICE_ID;
      
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: isLifetime ? 'payment' : 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        metadata: {
          userId,
        },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error('Stripe error:', error);
      if (error.type === 'StripeAuthenticationError') {
        return res.status(401).json({ 
          error: 'Invalid Stripe API Key. Please verify your STRIPE_SECRET_KEY in the Settings menu.' 
        });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Webhook: Handle successful payments
  // In a real app, you'd use this to update Firestore on the backend.
  // For this environment, we'll keep the client-side upgrade logic or assume the user uses the success URL.
  // However, it's safer to have a webhook. 
  // For now, I'll stick to the user's request of "reverting back" which usually means the checkout flow they saw.

  // API Route: Create Customer Portal Session
  app.post('/api/create-portal-session', async (req, res) => {
    const { userId, returnUrl } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    try {
      const stripe = getStripe();
      checkStripeKey(process.env.STRIPE_SECRET_KEY || '');
      
      // Search for the customer associated with this userId
      const customers = await stripe.customers.search({
        query: `metadata['userId']:'${userId}'`,
      });

      if (customers.data.length === 0) {
        return res.status(404).json({ 
          error: 'No active subscription found. You must complete a checkout first to access the Billing portal.' 
        });
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customers.data[0].id,
        return_url: returnUrl || 'http://localhost:3000',
      });

      res.json({ url: portalSession.url });
    } catch (error: any) {
      console.error('Portal error:', error);
      if (error.type === 'StripeAuthenticationError') {
        return res.status(401).json({ 
          error: 'Invalid Stripe API Key. Please verify your STRIPE_SECRET_KEY in the Settings menu.' 
        });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
