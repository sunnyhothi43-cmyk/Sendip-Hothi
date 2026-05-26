import React from 'react';
import { X, Zap, CheckCircle, RotateCcw, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { UserProfile } from '../types';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  paywallReason: 'favorites' | 'print';
  user: any;
  userProfile: UserProfile | null;
  handleCreateCheckoutSession: (priceId: string | undefined) => Promise<void>;
  handleCreatePortalSession: () => Promise<void>;
  handleCancelMembership: () => Promise<void>;
  isProcessingPayment: boolean;
  checkoutUrl: string | null;
  error: string | null;
  setError: (err: string | null) => void;
  selectedPlanId: string;
  setSelectedPlanId: (planId: string) => void;
}

export function PaywallModal({
  isOpen,
  onClose,
  paywallReason,
  user,
  userProfile,
  handleCreateCheckoutSession,
  handleCreatePortalSession,
  handleCancelMembership,
  isProcessingPayment,
  checkoutUrl,
  error,
  setError,
  selectedPlanId,
  setSelectedPlanId,
}: PaywallModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/90 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl custom-scrollbar"
          >
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-neutral-500 hover:text-white transition-colors z-20 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="p-4 sm:p-8">
              <div className="text-center mb-8 pt-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 mb-4">
                  <Zap className="w-8 h-8 text-red-500" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-white uppercase italic tracking-tighter mb-2">
                  {paywallReason === 'favorites' ? 'Library limit reached' : 'Print limit reached'}
                </h2>
                <p className="text-neutral-400 text-xs sm:text-sm max-w-md mx-auto">
                  You've reached the free trial limit of 5 {paywallReason === 'favorites' ? 'favorite songs' : 'prints'}. 
                  Upgrade to Chordstream Premium for unlimited access.
                </p>
              </div>

              {error && (
                <div className="mb-6 bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-start gap-3">
                  <div className="text-xs text-red-200 leading-relaxed font-medium">
                    {error}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pb-2 max-w-xl mx-auto">
                {[
                  {
                    id: 'monthly',
                    name: 'Monthly',
                    price: '€10',
                    interval: '/mo',
                    priceId: import.meta.env.VITE_STRIPE_MONTHLY_PRICE_ID,
                    features: ['Unlimited Favorites', 'Core Features'],
                    badge: null,
                    color: 'amber'
                  },
                  {
                    id: 'yearly',
                    name: 'Annual',
                    price: '€60',
                    interval: '/yr',
                    priceId: import.meta.env.VITE_STRIPE_YEARLY_PRICE_ID,
                    features: ['Save €60/year', 'Advanced Tools'],
                    badge: 'Value',
                    color: 'red'
                  },
                  {
                    id: 'lifetime',
                    name: 'Lifetime',
                    price: '€120',
                    interval: '',
                    priceId: import.meta.env.VITE_STRIPE_LIFETIME_PRICE_ID,
                    features: ['Forever Access', 'Future Updates'],
                    badge: 'Legacy',
                    color: 'purple'
                  }
                ].map((plan) => (
                  <div 
                    key={plan.id}
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={cn(
                      "relative p-2.5 rounded-lg flex flex-col transition-all border cursor-pointer active:scale-[0.98]",
                      selectedPlanId === plan.id
                        ? "bg-neutral-900 border-amber-500 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/30" 
                        : "bg-neutral-950/40 border-neutral-800/50 hover:border-neutral-700"
                    )}
                  >
                    {plan.badge && (
                      <div className={cn(
                        "absolute -top-1.5 left-2 text-[5px] font-black uppercase px-2 py-0.5 rounded-full tracking-tighter z-10 border",
                        plan.id === 'yearly' 
                          ? "bg-red-500 text-white border-red-400" 
                          : "bg-neutral-800 text-neutral-400 border-neutral-700"
                      )}>
                        {plan.badge}
                      </div>
                    )}
                    
                    <div className="text-left mb-1.5">
                      <span className={cn(
                        "text-[6px] font-black uppercase tracking-widest transition-colors",
                        selectedPlanId === plan.id ? "text-amber-500" : "text-neutral-500"
                      )}>{plan.name}</span>
                      <div className="flex items-baseline gap-0.5">
                        <span className="text-base font-black text-white">{plan.price}</span>
                        {plan.interval && <span className="text-[7px] text-neutral-600 font-bold uppercase">{plan.interval}</span>}
                      </div>
                    </div>

                    <ul className="space-y-1 mb-3 flex-1">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-1 text-[8px] text-neutral-400 leading-tight">
                          <CheckCircle className={cn("w-2 h-2 shrink-0", selectedPlanId === plan.id ? "text-amber-500" : "text-neutral-600")} />
                          {feature}
                        </li>
                      ))}
                    </ul>

                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPlanId(plan.id);
                        handleCreateCheckoutSession(plan.priceId);
                      }}
                      disabled={isProcessingPayment || !plan.priceId}
                      className={cn(
                        "w-full py-1 rounded-md text-[7px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer",
                        selectedPlanId === plan.id
                          ? "bg-amber-500 hover:bg-amber-400 text-black shadow-sm" 
                          : "bg-neutral-800/80 hover:bg-neutral-800 text-neutral-400"
                      )}
                    >
                      {isProcessingPayment ? (
                        <RotateCcw className="w-2 h-2 animate-spin" />
                      ) : (
                        <>
                          <Zap className={cn("w-2 h-2", selectedPlanId === plan.id ? "fill-black" : "fill-neutral-600 text-neutral-600")} />
                          {plan.id === 'lifetime' ? 'Get' : 'Select'}
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-8 text-center border-t border-neutral-900 pt-6 pb-6">
                <p className="text-[9px] text-neutral-600 uppercase tracking-widest mb-4">Secure payments by Stripe. Cancel anytime.</p>
                
                {user && (
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <button 
                      onClick={handleCreatePortalSession}
                      disabled={isProcessingPayment}
                      className="text-[9px] font-black uppercase tracking-widest text-neutral-500 hover:text-amber-500 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Settings className="w-2.5 h-2.5" />
                      Manage via Stripe
                    </button>
                    
                    {userProfile?.isSubscribed && (
                      <button 
                        onClick={handleCancelMembership}
                        disabled={isProcessingPayment}
                        className="text-[9px] font-black uppercase tracking-widest text-red-500 hover:text-red-400 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <X className="w-2.5 h-2.5" />
                        Cancel Membership Anytime
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
