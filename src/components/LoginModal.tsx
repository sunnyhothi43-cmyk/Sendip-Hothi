import React, { useState, useEffect } from 'react';
import { X, LogIn, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { 
  auth, 
  loginWithGoogle, 
  loginWithGoogleRedirect, 
  signUpWithEmail, 
  loginWithEmail, 
  db 
} from '../lib/firebase';
import firebaseConfig from '../firebase-applet-config.json';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  fontSize: number;
  isEasyMode: boolean;
  scrollSpeed: number;
  defaultMode?: 'signin' | 'signup';
}

export function LoginModal({ isOpen, onClose, fontSize, isEasyMode, scrollSpeed, defaultMode }: LoginModalProps) {
  const [loginMode, setLoginMode] = useState<'signin' | 'signup'>('signup');
  const [isManualLoggingIn, setIsManualLoggingIn] = useState(false);
  const [manualLoginData, setManualLoginData] = useState({ name: '', email: '', country: '', password: '' });
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLoginMode(defaultMode || 'signup');
    }
  }, [isOpen, defaultMode]);

  const handleClose = () => {
    setManualLoginData({ name: '', email: '', country: '', password: '' });
    setShowEmailForm(false);
    setError(null);
    onClose();
  };

  const handleGoogleLogin = async () => {
    try {
      setError(null);
      await loginWithGoogle();
      handleClose();
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        setError(null); 
      } else if (
        err.code === 'auth/popup-blocked' || 
        err.code === 'auth/cancelled-popup-request' ||
        err.message?.includes('popup') || 
        err.code?.includes('iframe')
      ) {
        console.log("Popup blocked or failed, falling back to redirect...");
        try {
          await loginWithGoogleRedirect();
        } catch (redirectErr: any) {
          setError(redirectErr.message || "Failed to initiate redirect sign in.");
          console.error("Redirect fallback error:", redirectErr);
        }
      } else {
        console.warn("Popup login failed, attempting browser redirect fallback:", err);
        try {
          await loginWithGoogleRedirect();
        } catch (redirectErr: any) {
          setError(err.message || "Failed to sign in.");
          console.error("Redirect fallback error:", redirectErr);
        }
      }
    }
  };

  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = manualLoginData.email.trim();
    if (!email || !manualLoginData.password) {
      setError("Please fill in email and password");
      return;
    }

    if (loginMode === 'signup' && (!manualLoginData.name || !manualLoginData.country)) {
      setError("Please fill in all fields for registration");
      return;
    }

    setIsManualLoggingIn(true);
    setError(null);
    try {
      let user;
      if (loginMode === 'signup') {
        user = await signUpWithEmail(email, manualLoginData.password, manualLoginData.name);
        if (user && db) {
          // Create initial profile for new user
          await setDoc(doc(db, 'users', user.uid), {
            favoritesCount: 0,
            printCount: 0,
            isSubscribed: false,
            displayName: manualLoginData.name,
            email: email,
            country: manualLoginData.country,
            preferences: {
              fontSize: fontSize || 15,
              showStrummingPattern: true,
              isEasyMode: isEasyMode || false,
              scrollSpeed: scrollSpeed || 20
            },
            updatedAt: serverTimestamp()
          });
        }
      } else {
        user = await loginWithEmail(email, manualLoginData.password);
      }
      
      handleClose();
    } catch (err: any) {
      let msg = "Failed to sign in";
      if (err.code === 'auth/operation-not-allowed') {
        const projectId = firebaseConfig.projectId;
        msg = `Email/Password sign-in is not enabled. Please enable it in the Firebase Console: https://console.firebase.google.com/project/${projectId}/authentication/providers`;
      } else if (err.code === 'auth/email-already-in-use') {
        msg = "Email already registered. Please sign in.";
      } else if (err.code === 'auth/invalid-credential') {
        msg = "Invalid email or password.";
      } else if (err.code === 'auth/weak-password') {
        msg = "Password should be at least 6 characters.";
      }
      setError(msg);
      console.error("Manual Login Error:", err);
    } finally {
      setIsManualLoggingIn(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[250] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="bg-[#0A0A0A] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden relative"
          >
            <button 
              onClick={handleClose}
              className="absolute top-4 right-4 p-2 text-neutral-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="p-8">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
                  <LogIn className="w-5 h-5 text-black" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-black text-white uppercase tracking-tighter">
                    {loginMode === 'signup' ? 'Create Account' : 'Welcome Back'}
                  </h2>
                  <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold">
                    {loginMode === 'signup' ? 'Select your preferred method' : 'Choose how you want to sign in'}
                  </p>
                </div>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3"
                >
                  <Info className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-[10px] text-red-500 font-bold uppercase tracking-wider leading-relaxed">
                      {error}
                    </p>
                  </div>
                  <button onClick={() => setError(null)} className="text-neutral-500 hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                </motion.div>
              )}

              <div className="space-y-6">
                {!showEmailForm ? (
                  <div className="grid grid-cols-1 gap-3">
                    <button 
                      onClick={handleGoogleLogin}
                      className="group relative w-full flex items-center justify-center gap-4 px-6 py-5 bg-white text-black rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-neutral-200 transition-all active:scale-[0.98] shadow-2xl shadow-white/5"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Continue with Google
                    </button>

                    <div className="relative py-2">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-white/5"></div>
                      </div>
                      <div className="relative flex justify-center text-[8px] uppercase tracking-[0.3em] font-black">
                        <span className="bg-[#0A0A0A] px-4 text-neutral-600 italic">or</span>
                      </div>
                    </div>

                    <button 
                      onClick={() => { setManualLoginData({ name: '', email: '', country: '', password: '' }); setShowEmailForm(true); }}
                      className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-neutral-900 border border-white/10 text-white rounded-2xl font-black uppercase tracking-widest text-[9px] hover:bg-neutral-800 transition-all active:scale-[0.98]"
                    >
                      Sign in with Email
                    </button>
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                  >
                    <button 
                      onClick={() => { setManualLoginData({ name: '', email: '', country: '', password: '' }); setShowEmailForm(false); }}
                      className="text-[8px] text-neutral-500 hover:text-amber-500 uppercase font-black tracking-widest mb-4 flex items-center gap-2 group"
                    >
                      <X className="w-3 h-3 group-hover:rotate-90 transition-transform" />
                      Back to options
                    </button>
                    
                    <form onSubmit={handleManualLogin} className="space-y-3">
                      {loginMode === 'signup' && (
                        <div className="grid grid-cols-2 gap-3">
                          <input 
                            type="text"
                            placeholder="NAME"
                            className="w-full bg-neutral-900 border border-white/5 p-4 rounded-xl text-[10px] text-white uppercase tracking-widest placeholder:text-neutral-600 focus:border-amber-500/50 outline-none transition-all font-bold opacity-100"
                            value={manualLoginData.name}
                            onChange={e => setManualLoginData({ ...manualLoginData, name: e.target.value })}
                            required
                          />
                          <input 
                            type="text"
                            placeholder="COUNTRY"
                            className="w-full bg-neutral-900 border border-white/5 p-4 rounded-xl text-[10px] text-white uppercase tracking-widest placeholder:text-neutral-600 focus:border-amber-500/50 outline-none transition-all font-bold opacity-100"
                            value={manualLoginData.country}
                            onChange={e => setManualLoginData({ ...manualLoginData, country: e.target.value })}
                            required
                          />
                        </div>
                      )}
                      <input 
                        type="email"
                        placeholder="EMAIL"
                        autoFocus
                        className="w-full bg-neutral-900 border border-white/5 p-4 rounded-xl text-[10px] text-white uppercase tracking-widest placeholder:text-neutral-600 focus:border-amber-500/50 outline-none transition-all font-bold opacity-100"
                        value={manualLoginData.email}
                        onChange={e => setManualLoginData({ ...manualLoginData, email: e.target.value })}
                        required
                      />
                      <input 
                        type="password"
                        placeholder="PASSWORD"
                        className="w-full bg-neutral-900 border border-white/5 p-4 rounded-xl text-[10px] text-white uppercase tracking-widest placeholder:text-neutral-600 focus:border-amber-500/50 outline-none transition-all font-bold opacity-100"
                        value={manualLoginData.password}
                        onChange={e => setManualLoginData({ ...manualLoginData, password: e.target.value })}
                        required
                      />
                      <button 
                        type="submit"
                        disabled={isManualLoggingIn}
                        className="w-full py-4 bg-amber-500 text-black border border-amber-500/20 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all disabled:opacity-50 hover:bg-amber-400 active:scale-95 shadow-lg shadow-amber-500/20 mt-2 cursor-pointer"
                      >
                        {isManualLoggingIn ? 'Processing...' : (loginMode === 'signup' ? 'Create Account' : 'Sign In')}
                      </button>
                    </form>
                  </motion.div>
                )}

                <div className="pt-2 text-center">
                  <button 
                    onClick={() => {
                      setLoginMode(loginMode === 'signup' ? 'signin' : 'signup');
                      setManualLoginData({ name: '', email: '', country: '', password: '' });
                      setShowEmailForm(false);
                    }}
                    className="text-[9px] uppercase tracking-widest font-black text-neutral-500 hover:text-amber-500 transition-colors cursor-pointer"
                  >
                    {loginMode === 'signup' ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
