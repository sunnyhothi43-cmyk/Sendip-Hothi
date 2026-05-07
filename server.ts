import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';

// Load .env.local first, then .env
dotenv.config({ path: '.env.local' });
dotenv.config();

const stripeEnabled = !!process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim().startsWith('sk_');

let stripeClient: any = null;

async function getStripe() {
  if (!stripeEnabled) return null;
  if (!stripeClient) {
    const Stripe = (await import('stripe')).default;
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-12-18.acacia' as any,
    });
  }
  return stripeClient;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  app.get('/api/stripe-config', (req, res) => {
    const key = process.env.STRIPE_SECRET_KEY || '';
    const sanitized = key.trim();
    res.json({
      hasSecretKey: stripeEnabled,
      secretKeyPrefix: sanitized.substring(0, 7),
      secretKeyLength: sanitized.length,
      isTruncated: sanitized.includes('...') || sanitized.includes('***'),
      isSkPrefix: sanitized.startsWith('sk_'),
      publishableKey: process.env.VITE_STRIPE_PUBLISHABLE_KEY || 'Not Set',
      priceIds: {
        monthly: process.env.VITE_STRIPE_MONTHLY_PRICE_ID || '',
        yearly: process.env.VITE_STRIPE_YEARLY_PRICE_ID || '',
        lifetime: process.env.VITE_STRIPE_LIFETIME_PRICE_ID || '',
      }
    });
  });

  app.post('/api/create-checkout-session', async (req, res) => {
    if (!stripeEnabled) {
      return res.status(503).json({ error: 'Stripe payments are not configured.' });
    }
    const { priceId, userId, successUrl, cancelUrl } = req.body;
    if (!priceId || !userId) {
      return res.status(400).json({ error: 'Missing priceId or userId' });
    }
    try {
      const stripe = await getStripe();
      const isLifetime = priceId === process.env.VITE_STRIPE_LIFETIME_PRICE_ID;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: isLifetime ? 'payment' : 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        metadata: { userId },
      });
      res.json({ url: session.url });
    } catch (error: any) {
      console.error('Stripe checkout error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/create-portal-session', async (req, res) => {
    if (!stripeEnabled) {
      return res.status(503).json({ error: 'Stripe payments are not configured.' });
    }
    const { userId, returnUrl } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }
    try {
      const stripe = await getStripe();
      const customers = await stripe.customers.search({
        query: `metadata['userId']:'${userId}'`,
      });
      if (customers.data.length === 0) {
        return res.status(404).json({ error: 'No active subscription found.' });
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customers.data[0].id,
        return_url: returnUrl || `http://localhost:${PORT}`,
      });
      res.json({ url: portalSession.url });
    } catch (error: any) {
      console.error('Portal error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎸 Chordstream running at http://localhost:${PORT}`);
    console.log(`💳 Stripe: ${stripeEnabled ? 'enabled' : 'disabled (no key set)'}`);
    console.log(`🤖 Gemini: ${process.env.GEMINI_API_KEY ? 'key found ✓' : '⚠️  GEMINI_API_KEY missing!'}\n`);
  });
}

startServer();            
