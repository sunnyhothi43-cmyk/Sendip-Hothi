/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_STRIPE_MONTHLY_PRICE_ID: string;
  readonly VITE_STRIPE_YEARLY_PRICE_ID: string;
  readonly VITE_STRIPE_LIFETIME_PRICE_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
