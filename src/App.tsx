import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Music, Settings, ArrowUp, ArrowDown, Play, Pause, RotateCcw, Minus, Plus, Home, X, Printer, LogIn, LogOut, Heart, Trash2, Sparkles, Info, Zap, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchSongData, SongData, fetchRecommendations, searchSongs, fetchChordFingering } from './services/geminiService';
import { transposeLine, parseChordSegments, getEasyKeyOffset, transposeChord } from './lib/musicUtils';
import { cn } from './lib/utils';
import { PRELOADED_SONGS } from './lib/preloadedSongs';
import { auth, loginWithGoogle, loginAnonymously, signUpWithEmail, loginWithEmail, logout, db, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query as fsQuery, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, orderBy, DocumentData, getDoc, setDoc, increment, updateDoc } from 'firebase/firestore';
import { CHORD_LIBRARY, ChordPosition } from './lib/chordLibrary';
import { ChordDiagram } from './components/ChordDiagram';
import firebaseConfig from './firebase-applet-config.json';

interface LibrarySong extends SongData {
  id: string;
}

interface UserProfile {
  favoritesCount: number;
  printCount: number;
  isSubscribed: boolean;
  subscriptionType?: 'monthly' | 'yearly' | 'lifetime';
  renewalDate?: any;
  displayName?: string;
  email?: string;
  country?: string;
  updatedAt: any;
}

export default function App() {
  const [query, setQuery] = useState('');
  const [song, setSong] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{ title: string; artist: string }[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [library, setLibrary] = useState<LibrarySong[]>([]);
  const [localLibrary, setLocalLibrary] = useState<LibrarySong[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<{ title: string; artist: string }[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const lastRecsKeyRef = useRef<string>("");
  
  const [keyOffset, setKeyOffset] = useState(0);
  const [currentTempo, setCurrentTempo] = useState(0);
  const [scrollSpeed, setScrollSpeed] = useState(20);
  const [isScrolling, setIsScrolling] = useState(false);
  const [fontSize, setFontSize] = useState(15); 
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEasyMode, setIsEasyMode] = useState(false);
  const [isStrummingEnabled, setIsStrummingEnabled] = useState(true);
  const [selectedChord, setSelectedChord] = useState<{ name: string; positions: ChordPosition[]; currentIndex: number } | null>(null);
  const [loadingChord, setLoadingChord] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallReason, setPaywallReason] = useState<'favorites' | 'print'>('favorites');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [stripeStatus, setStripeStatus] = useState<any>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('yearly');
  
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginMode, setLoginMode] = useState<'signin' | 'signup'>('signup');
  const [manualLoginData, setManualLoginData] = useState({ name: '', email: '', country: '', password: '' });
  const [isManualLoggingIn, setIsManualLoggingIn] = useState(false);

  const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';

  // Fetch user profile
  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      return;
    }

    const unsub = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      const isAdmin = user.email === 'sunny.hothi43@gmail.com';
      if (snapshot.exists()) {
        const data = snapshot.data();
        // Force subscribe admin if somehow not subscribed in DB
        if (isAdmin && (!data.isSubscribed || !data.subscriptionType)) {
          updateDoc(doc(db, 'users', user.uid), { 
            isSubscribed: true, 
            subscriptionType: 'lifetime',
            updatedAt: serverTimestamp() 
          });
        }
        setUserProfile(data as any);
      } else {
        const initialProfile = {
          favoritesCount: 0,
          printCount: 0,
          isSubscribed: isAdmin, // Admins start as subscribed
          subscriptionType: isAdmin ? 'lifetime' : null,
          updatedAt: serverTimestamp()
        };
        setDoc(doc(db, 'users', user.uid), initialProfile);
        setUserProfile(initialProfile as any);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`));

    return () => unsub();
  }, [user]);

  // Fetch stripe config status once
  useEffect(() => {
    fetch('/api/stripe-config')
      .then(res => res.json())
      .then(data => setStripeStatus(data))
      .catch(err => console.error('Error fetching stripe status:', err));
  }, []);

  const hasStripeConfigError = useMemo(() => {
    if (!stripeStatus) return false;
    const priceIds = stripeStatus.priceIds || {};
    const invalidFormat = Object.values(priceIds).some((val: any) => 
      val?.startsWith('http') || val?.startsWith('buy.stripe.com') || val?.startsWith('prod_')
    );
    return stripeStatus.isTruncated || stripeStatus.secretKeyPrefix === 'Nil' || !stripeStatus.isSkPrefix || invalidFormat;
  }, [stripeStatus]);

  const handleCreateCheckoutSession = async (priceId: string | undefined) => {
    console.log("Initiating checkout with Price ID:", priceId);
    if (!user) {
      setError("Please sign in to subscribe");
      return;
    }

    if (priceId) {
      if (priceId.startsWith('http') || priceId.includes('buy.stripe.com')) {
        setError(`Configuration Error: You provided a Payment Link URL instead of a Price ID. Please replace it with the "Price ID" (price_...) in Settings -> Environment Variables.`);
        return;
      }
      if (priceId.startsWith('prod_')) {
        setError(`Configuration Error: You provided a Product ID ("${priceId}") instead of a Price ID. Stripe needs the Price ID (starts with price_...) which you can find in the "Pricing" section of your product in Stripe.`);
        return;
      }
    }

    if (!priceId) {
      setError("Price ID not configured. Check VITE_STRIPE_MONTHLY_PRICE_ID, etc. in Settings.");
      return;
    }

    setError(null);
    setIsProcessingPayment(true);
    setCheckoutUrl(null);
    
    // Save intended plan to localStorage so we can fulfill it after redirect
    localStorage.setItem('pending_stripe_plan', selectedPlanId);

    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId,
          userId: user.uid,
          successUrl: `${window.location.origin}/?success=true`,
          cancelUrl: `${window.location.origin}/?cancel=true`,
        }),
      });
      const data = await response.json();
      console.log("Checkout session response:", data);
      if (data.url) {
        setCheckoutUrl(data.url);
        // Try to redirect the top window logic
        try {
          // Check if we are in an iframe
          const isInIframe = window.self !== window.top;
          
          if (isInIframe) {
            // In an iframe, top navigation might be blocked by CSP/Sandbox
            // window.open with _top is often allowed when direct assignment isn't
            window.open(data.url, '_top');
            
            // Fallback: if _top didn't immediately navigate away, try _blank
            setTimeout(() => {
              if (document.visibilityState === 'visible') {
                window.open(data.url, '_blank');
              }
            }, 1000);
          } else {
            window.location.href = data.url;
          }
        } catch (e) {
          console.error("Redirection error:", e);
          // Last resort
          window.open(data.url, '_blank');
        }
      } else {
        throw new Error(data.error || "Failed to create checkout session");
      }
    } catch (error: any) {
      console.error("Payment error details:", error);
      setError(error.message);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleCreatePortalSession = async () => {
    if (!user) return;
    
    setIsProcessingPayment(true);
    setCheckoutUrl(null);
    try {
      const response = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          returnUrl: window.location.href,
        }),
      });
      const data = await response.json();
      if (data.url) {
        setCheckoutUrl(data.url);
        try {
          const isInIframe = window.self !== window.top;
          if (isInIframe) {
            window.open(data.url, '_top');
            setTimeout(() => {
              if (document.visibilityState === 'visible') {
                window.open(data.url, '_blank');
              }
            }, 1000);
          } else {
            window.location.href = data.url;
          }
        } catch (e) {
          console.error("Portal redirection error:", e);
          window.open(data.url, '_blank');
        }
      } else {
        if (data.error?.includes('No active subscription')) {
          setPaywallReason('favorites');
          setShowPaywall(true);
          setError("You don't have an active subscription yet. Subscribe below to access the billing portal.");
        } else {
          throw new Error(data.error || "Failed to create portal session");
        }
      }
    } catch (error: any) {
      console.error("Portal error:", error);
      setError(error.message);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Check for success URL parameter to simulate post-checkout fulfillment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'true' && user) {
      const pendingPlan = localStorage.getItem('pending_stripe_plan') as 'monthly' | 'yearly' | 'lifetime' || 'yearly';
      
      const calculateRenewalDate = (type: string) => {
        const d = new Date();
        if (type === 'monthly') {
          d.setMonth(d.getMonth() + 1);
          return d;
        }
        if (type === 'yearly') {
          d.setFullYear(d.getFullYear() + 1);
          return d;
        }
        return null; // Lifetime
      };

      updateDoc(doc(db, 'users', user.uid), {
        isSubscribed: true,
        subscriptionType: pendingPlan,
        renewalDate: calculateRenewalDate(pendingPlan),
        updatedAt: serverTimestamp()
      }).then(() => {
        localStorage.removeItem('pending_stripe_plan');
        // Clear param to avoid re-triggering
        window.history.replaceState({}, document.title, window.location.pathname);
        alert("Thank you! Your subscription is now active.");
      });
    }
  }, [user]);

  const checkLimit = (type: 'favorites' | 'print'): boolean => {
    const isSubscribed = userProfile?.isSubscribed || false;
    if (isSubscribed) return true;
    
    if (type === 'favorites' && displayLibrary.length >= 5) {
      setPaywallReason('favorites');
      setShowPaywall(true);
      return false;
    }
    if (type === 'print' && (userProfile?.printCount || 0) >= 5) {
      setPaywallReason('print');
      setShowPaywall(true);
      return false;
    }
    return true;
  };

  const handleChordClick = async (chord: string) => {
    const match = chord.match(/^([A-G][#b]?)(.*)$/);
    if (!match) return;
    
    setLoadingChord(true);
    setSelectedChord({ name: chord, positions: [], currentIndex: 0 });
    
    let positions = CHORD_LIBRARY[chord]?.positions || [];
    
    if (positions.length === 0) {
      const base = chord.replace(/(m|maj|M|7|sus[24]|add[249])*$/, '');
      positions = CHORD_LIBRARY[base]?.positions || [];
    }

    if (positions.length === 0) {
      const fetched = await fetchChordFingering(chord);
      if (fetched) {
        positions = [{
          frets: fetched.frets,
          fingers: fetched.fingers,
          barres: fetched.barres
        }];
      }
    }

    setSelectedChord({ name: chord, positions, currentIndex: 0 });
    setLoadingChord(false);
  };

  // Load local library on mount
  useEffect(() => {
    const saved = localStorage.getItem('chord_guest_library');
    if (saved) {
      try {
        setLocalLibrary(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse local library");
      }
    }
  }, []);

  // Sync local library to localStorage
  useEffect(() => {
    localStorage.setItem('chord_guest_library', JSON.stringify(localLibrary));
  }, [localLibrary]);

  // Combined library view
  const displayLibrary = useMemo(() => {
    const raw = user ? library : localLibrary;
    return [...raw].sort((a, b) => {
      const artistComp = a.artist.localeCompare(b.artist);
      if (artistComp !== 0) return artistComp;
      return a.title.localeCompare(b.title);
    });
  }, [user, library, localLibrary]);

  // Global song cache to avoid re-fetching
  useEffect(() => {
    if (song && song.sections && song.sections.length > 0) {
      try {
        const cacheRaw = localStorage.getItem('chord_guest_cache');
        const cache = cacheRaw ? JSON.parse(cacheRaw) : [];
        const exists = cache.some((s: any) => s.title === song.title && s.artist === song.artist);
        if (!exists) {
          const newCache = [song, ...cache].slice(0, 20);
          localStorage.setItem('chord_guest_cache', JSON.stringify(newCache));
        }
      } catch (e) {
        console.error("Cache update failed", e);
      }
    }
  }, [song]);

  const lastTimeRef = useRef<number>(0);

  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isRefreshingRecs, setIsRefreshingRecs] = useState(false);

  const handlePrintAction = async () => {
    if (!checkLimit('print')) return;

    // Print must be triggered directly in the user event handler for many browsers.
    // We focus first to ensure the iframe is active.
    window.focus();
    try {
      window.print();
      
      // Update print count in Firestore
      if (user) {
        await updateDoc(doc(db, 'users', user.uid), {
          printCount: increment(1),
          updatedAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.error("System print failed:", e);
    }
    // Close modal after initiating the browser's print dialog
    setIsPrintModalOpen(false);
  };

  const handleRefreshRecs = async () => {
    if (isRefreshingRecs || loadingRecs) return;
    setIsRefreshingRecs(true);
    try {
      const artists = displayLibrary.map(l => l.artist);
      if (artists.length > 0) {
        // Shuffle and take more artists for better variety
        const shuffled = [...new Set(artists)].sort(() => 0.5 - Math.random()) as string[];
        await loadRecs(shuffled.slice(0, 10));
      } else {
        // Fallback for empty library
        await loadRecs(["The Beatles", "Oasis", "Pink Floyd", "Radiohead", "Green Day", "Coldplay"]);
      }
    } finally {
      setIsRefreshingRecs(false);
    }
  };

  const handlePrint = useCallback(() => {
    setIsPrintModalOpen(true);
  }, []);

  const handleSearch = async (e?: React.FormEvent, customQuery?: string) => {
    e?.preventDefault();
    const searchQuery = customQuery || query;
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    setError(null);
    setSearchResults([]);
    
    // 1. Check Library (Favorites) first for instant access
    const normalizedQuery = searchQuery.toLowerCase().trim();
    let cachedSong = displayLibrary.find(s => 
      `${s.artist} - ${s.title}`.toLowerCase().trim() === normalizedQuery ||
      `${s.title} - ${s.artist}`.toLowerCase().trim() === normalizedQuery ||
      s.title.toLowerCase().trim() === normalizedQuery ||
      (normalizedQuery.includes(s.title.toLowerCase()) && normalizedQuery.includes(s.artist.toLowerCase()))
    );

    // 2. Then check local search cache
    if (!cachedSong) {
      try {
        const cacheRaw = localStorage.getItem('chord_guest_cache');
        const cache = cacheRaw ? JSON.parse(cacheRaw) : [];
        cachedSong = cache.find((s: any) => 
          `${s.artist} - ${s.title}`.toLowerCase().trim() === normalizedQuery ||
          `${s.title} - ${s.artist}`.toLowerCase().trim() === normalizedQuery ||
          s.title.toLowerCase().trim() === normalizedQuery ||
          (normalizedQuery.includes(s.title.toLowerCase()) && normalizedQuery.includes(s.artist.toLowerCase()))
        );
      } catch (e) {
        console.warn("Cache read failed");
      }
    }

    if (cachedSong && cachedSong.sections && cachedSong.sections.length > 0) {
      setSong(cachedSong);
      const initialOffset = isEasyMode ? getEasyKeyOffset(cachedSong.sections) : 0;
      setKeyOffset(initialOffset);
      setCurrentTempo(cachedSong.suggestedTempo);
      setIsScrolling(false);
      setIsSettingsOpen(false);
      window.scrollTo(0, 0);
      setLoading(false);
      return;
    }
    
    // If it looks like a specific request (Title - Artist), fetch directly
    const isSpecific = searchQuery.includes(' - ') || searchQuery.includes(' by ');
    
    try {
      if (isSpecific) {
        const data = await fetchSongData(searchQuery);
        setSong(data);
        const initialOffset = isEasyMode ? getEasyKeyOffset(data.sections) : 0;
        setKeyOffset(initialOffset);
        setCurrentTempo(data.suggestedTempo);
        setIsScrolling(false);
        setIsSettingsOpen(false);
        window.scrollTo(0, 0);

        // Add to local cache automatically so it's never re-fetched
        try {
          const cacheRaw = localStorage.getItem('chord_guest_cache');
          const cache = cacheRaw ? JSON.parse(cacheRaw) : [];
          const exists = cache.some((s: any) => s.title === data.title && s.artist === data.artist);
          if (!exists) {
            const newCache = [data, ...cache].slice(0, 30);
            localStorage.setItem('chord_guest_cache', JSON.stringify(newCache));
          }
        } catch (e) {
          console.warn("Auto-cache failed");
        }
      } else {
        // Broad search
        const results = await searchSongs(searchQuery);
        if (results.length > 0) {
          const sortedResults = [...results].sort((a, b) => {
            const artistComp = a.artist.localeCompare(b.artist);
            if (artistComp !== 0) return artistComp;
            return a.title.localeCompare(b.title);
          });
          setSearchResults(sortedResults);
          setSong(null); 
          window.scrollTo(0, 0);
        } else {
          // If search yielded nothing, try a direct fetch as a hail mary
          const data = await fetchSongData(searchQuery);
          if (data && data.sections && data.sections.length > 0) {
            setSong(data);
            setSearchResults([]);
          } else {
            setError("No results found. Try a different search!");
          }
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Song not found. Try Artist - Song format.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setLibrary([]);
      setRecommendations([]);
      return;
    }

    const q = fsQuery(
      collection(db, `users/${user.uid}/songs`),
      orderBy('savedAt', 'desc')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const libs = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as SongData) })) as LibrarySong[];
      setLibrary(libs);
      
      // Only fetch recs if artists have changed significantly
      if (libs.length > 0) {
        const artistKey = libs.map(l => l.artist).sort().slice(0, 5).join(",");
        if (artistKey !== lastRecsKeyRef.current) {
          lastRecsKeyRef.current = artistKey;
          loadRecs(libs.map(l => l.artist).slice(0, 5));
        }
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/songs`);
    });

    return () => unsub();
  }, [user]);

  const loadRecs = async (artists: string[]) => {
    if (loadingRecs) return;
    setRecommendations([]); 
    setLoadingRecs(true);
    try {
      const recs = await fetchRecommendations(artists);
      // Ensure we have unique suggestions that aren't already in library
      const sorted = [...recs].sort((a, b) => {
        const artistComp = a.artist.localeCompare(b.artist);
        if (artistComp !== 0) return artistComp;
        return a.title.localeCompare(b.title);
      });
      // Ensure we have unique suggestions that aren't already in library or preloaded
      const filtered = sorted.filter(rec => {
        const inLibrary = displayLibrary.some(l => 
          l.title.toLowerCase().trim() === rec.title.toLowerCase().trim() &&
          l.artist.toLowerCase().trim() === rec.artist.toLowerCase().trim()
        );
        const isPreloaded = PRELOADED_SONGS.some(p => 
          p.title.toLowerCase().trim() === rec.title.toLowerCase().trim() &&
          p.artist.toLowerCase().trim() === rec.artist.toLowerCase().trim()
        );
        return !inLibrary && !isPreloaded;
      });
      setRecommendations(filtered);
    } catch (err) {
      console.error("Failed to load recs", err);
    } finally {
      setLoadingRecs(false);
    }
  };

  const handleSaveSong = async (songToSave: any = song) => {
    if (!songToSave) return;
    
    // Check if already in favorites
    const isFav = displayLibrary.some(l => l.title === songToSave.title && l.artist === songToSave.artist);
    if (isFav) return;

    if (!checkLimit('favorites')) return;

    const sId = `${songToSave.artist}-${songToSave.title}`;
    setSavingId(sId);
    setIsSaving(true);
    setError(null);
    try {
      let data = songToSave;
      // If missing sections (recs or search results), fetch full data first
      if (!data.sections) {
        data = await fetchSongData(`${data.artist} - ${data.title}`);
      }

      // Explicitly pick only the fields allowed by firestore rules
      const finalData = {
        title: data.title,
        artist: data.artist,
        originalKey: data.originalKey || "C",
        suggestedTempo: data.suggestedTempo || 120,
        sections: data.sections || [],
        strummingPattern: data.strummingPattern || "",
      };

      if (user) {
        await addDoc(collection(db, `users/${user.uid}/songs`), {
          ...finalData,
          userId: user.uid,
          savedAt: serverTimestamp()
        });
        
        // Increment favorites count
        await updateDoc(doc(db, 'users', user.uid), {
          favoritesCount: increment(1),
          updatedAt: serverTimestamp()
        });
      } else {
        // Guest mode - save to local state
        const newGuestSong: LibrarySong = {
          ...finalData,
          id: `guest-${Date.now()}`
        };
        setLocalLibrary(prev => [newGuestSong, ...prev]);
      }
    } catch (err: any) {
      setError("Failed to save to favorites. Please try again.");
      console.error("Save error:", err);
      if (user) handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/songs`);
    } finally {
      setIsSaving(false);
      setSavingId(null);
    }
  };

  const handleUnsaveSong = async (artist: string, title: string) => {
    const item = displayLibrary.find(l => l.artist === artist && l.title === title);
    if (item) {
      handleDeleteSong(item.id);
    }
  };

  const handleDeleteSong = async (id: string) => {
    if (!user) {
      setLocalLibrary(prev => prev.filter(s => s.id !== id));
      return;
    }
    try {
      await deleteDoc(doc(db, `users/${user.uid}/songs`, id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/songs/${id}`);
    }
  };

  const selectPreloaded = (preloaded: SongData) => {
    if (!preloaded || !preloaded.sections) return;
    setSong(preloaded);
    const initialOffset = isEasyMode ? getEasyKeyOffset(preloaded.sections) : 0;
    setKeyOffset(initialOffset);
    setCurrentTempo(preloaded.suggestedTempo || 100);
    setIsScrolling(false);
    setIsSettingsOpen(false);
    window.scrollTo(0, 0);
  };

  const goHome = () => {
    setSong(null);
    setSearchResults([]);
    setQuery('');
    setError(null);
    setIsScrolling(false);
    window.scrollTo(0, 0);
  };

  const requestRef = useRef<number>(null);

  const scrollStep = useCallback((time: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = time;
    const delta = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;

    if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight) {
      window.scrollBy(0, scrollSpeed * delta);
      requestRef.current = requestAnimationFrame(scrollStep);
    } else {
      setIsScrolling(false);
      lastTimeRef.current = 0;
    }
  }, [scrollSpeed]);

  useEffect(() => {
    if (isScrolling) {
      lastTimeRef.current = 0;
      requestRef.current = requestAnimationFrame(scrollStep);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isScrolling, scrollStep]);

  const handleLogin = async () => {
    setIsLoginModalOpen(true);
  };

  const handleGoogleLogin = async () => {
    try {
      setError(null);
      await loginWithGoogle();
      setIsLoginModalOpen(false);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        // Just clear the error or show a very subtle message if needed, 
        // but don't log it as a prominent error
        setError(null); 
      } else {
        setError(err.message || "Failed to sign in");
        console.error("Login Error:", err);
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
        if (user) {
          // Create initial profile for new user
          await setDoc(doc(db, 'users', user.uid), {
            favoritesCount: 0,
            printCount: 0,
            isSubscribed: false,
            displayName: manualLoginData.name,
            email: email,
            country: manualLoginData.country,
            updatedAt: serverTimestamp()
          });
        }
      } else {
        user = await loginWithEmail(email, manualLoginData.password);
      }
      
      setIsLoginModalOpen(false);
      setManualLoginData({ name: '', email: '', country: '', password: '' });
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

  const resetScroll = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setIsScrolling(false);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-[#E0E0E0] font-sans selection:bg-amber-500/30">
      {/* Global Payment Loading Overlay */}
      <AnimatePresence>
        {isProcessingPayment && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center text-center p-6"
          >
            <div className="relative w-20 h-20 mb-8">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 rounded-full border-4 border-amber-500/10 border-t-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
              />
              <motion.div 
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <Zap className="w-8 h-8 text-amber-500 fill-amber-500" />
              </motion.div>
            </div>
            <motion.h3 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-xl font-black text-white uppercase tracking-tighter mb-2"
            >
              Preparing Secure Checkout
            </motion.h3>
            <motion.p 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-neutral-400 text-xs uppercase tracking-widest leading-relaxed mb-6"
            >
              Redirecting you to Stripe<br />Please do not refresh the page
            </motion.p>
            
            {checkoutUrl && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center"
              >
                <div className="text-[10px] text-neutral-600 mb-4 uppercase tracking-[0.2em]">Redirect blocked?</div>
                <button 
                   onClick={() => window.open(checkoutUrl, '_blank')}
                  className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-[10px] font-black uppercase tracking-widest transition-all"
                >
                   Click here to pay manually
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Login Modal */}
      <AnimatePresence>
        {isLoginModalOpen && (
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
                onClick={() => setIsLoginModalOpen(false)}
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
                  {/* Choice Grid */}
                  {!manualLoginData.email && !isManualLoggingIn ? (
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
                        onClick={() => setManualLoginData({ ...manualLoginData, email: ' ' })} // Dummy space to show form
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
                        onClick={() => setManualLoginData({ ...manualLoginData, email: '' })}
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
                              className="w-full bg-neutral-900 border border-white/5 p-4 rounded-xl text-[10px] text-white uppercase tracking-widest placeholder:text-neutral-600 focus:border-amber-500/50 outline-none transition-all font-bold"
                              value={manualLoginData.name}
                              onChange={e => setManualLoginData({ ...manualLoginData, name: e.target.value })}
                              required
                            />
                            <input 
                              type="text"
                              placeholder="COUNTRY"
                              className="w-full bg-neutral-900 border border-white/5 p-4 rounded-xl text-[10px] text-white uppercase tracking-widest placeholder:text-neutral-600 focus:border-amber-500/50 outline-none transition-all font-bold"
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
                          className="w-full bg-neutral-900 border border-white/5 p-4 rounded-xl text-[10px] text-white uppercase tracking-widest placeholder:text-neutral-600 focus:border-amber-500/50 outline-none transition-all font-bold"
                          value={manualLoginData.email === ' ' ? '' : manualLoginData.email}
                          onChange={e => setManualLoginData({ ...manualLoginData, email: e.target.value })}
                          required
                        />
                        <input 
                          type="password"
                          placeholder="PASSWORD"
                          className="w-full bg-neutral-900 border border-white/5 p-4 rounded-xl text-[10px] text-white uppercase tracking-widest placeholder:text-neutral-600 focus:border-amber-500/50 outline-none transition-all font-bold"
                          value={manualLoginData.password}
                          onChange={e => setManualLoginData({ ...manualLoginData, password: e.target.value })}
                          required
                        />
                        <button 
                          type="submit"
                          disabled={isManualLoggingIn}
                          className="w-full py-4 bg-amber-500 text-black border border-amber-500/20 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all disabled:opacity-50 hover:bg-amber-400 active:scale-95 shadow-lg shadow-amber-500/20 mt-2"
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
                        setManualLoginData({ ...manualLoginData, email: '' }); // Reset to choice on mode switch
                      }}
                      className="text-[9px] uppercase tracking-widest font-black text-neutral-500 hover:text-amber-500 transition-colors"
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
      {/* Print Preview Modal */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-white/10 p-6 rounded-2xl max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-center w-12 h-12 bg-amber-500/10 rounded-full mb-4 mx-auto">
              <Printer className="w-6 h-6 text-amber-500" />
            </div>
            <h3 className="text-lg font-bold text-white text-center mb-2">Print Song Sheet</h3>
            <p className="text-neutral-400 text-sm text-center mb-6 leading-relaxed">
              We've optimized the layout for A4 Paper. Use the browser's print dialog to save as PDF or print to your device.
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={handlePrintAction}
                className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 text-black font-black uppercase tracking-widest text-xs rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-amber-500/20"
              >
                Open System Print
              </button>
              <button 
                onClick={() => setIsPrintModalOpen(false)}
                className="w-full py-3.5 bg-neutral-800 hover:bg-neutral-700 text-white/70 font-bold uppercase tracking-widest text-[10px] rounded-xl transition-all"
              >
                Back to Song
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-neutral-950/98 border-b border-neutral-800/80 px-3 py-1.5 backdrop-blur-xl shadow-xl">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <button 
            onClick={goHome}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg font-black text-white uppercase tracking-widest text-[9px] hover:bg-neutral-800 transition-all shadow-sm group active:scale-95"
          >
            <Home className="w-3.5 h-3.5 text-amber-500 group-hover:scale-110 transition-transform" / >
            <span className="hidden sm:block">Home</span>
          </button>
          
          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="relative p-1.5 bg-neutral-900 border border-neutral-800 rounded-lg transition-all text-white hover:border-amber-500/50 hover:bg-neutral-800 active:scale-95 flex items-center gap-1.5 px-3 shadow-sm group"
              title="App Settings & Subscription"
            >
              <Settings className="w-3.5 h-3.5 group-hover:rotate-45 transition-transform" />
              <span className="text-[9px] font-black uppercase tracking-widest hidden md:inline">Settings</span>
              
              {user?.email === 'sunny.hothi43@gmail.com' && hasStripeConfigError && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
              )}
            </button>

            {user && (
              <button 
                onClick={handleCreatePortalSession}
                disabled={isProcessingPayment}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 active:scale-95 shadow-xl shadow-amber-500/30"
              >
                <Zap className="w-4 h-4 fill-black" />
                <span className="hidden xs:inline">Subscription</span>
              </button>
            )}

            <div className="w-px h-6 bg-neutral-800/80 mx-1" />

            {!user ? (
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleGoogleLogin}
                  className="p-2.5 bg-white text-black rounded-lg hover:bg-neutral-200 transition-all shadow-xl active:scale-95 group"
                  title="Sign in with Google"
                >
                  <svg className="w-4 h-4 select-none" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                </button>
                <div className="w-px h-6 bg-neutral-800/80 mx-1" />
                <button 
                   onClick={() => { setLoginMode('signin'); setIsLoginModalOpen(true); }}
                   className="flex items-center gap-2.5 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-black uppercase tracking-widest text-[10px] transition-all shadow-xl shadow-amber-500/30 active:scale-95 group"
                >
                  <LogIn className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  <span>Login / Join</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex flex-col items-end mr-1">
                  <span className="text-[10px] font-black uppercase tracking-tighter text-white leading-tight">
                    {userProfile?.displayName || user.displayName || 'Musician'}
                  </span>
                  <span className="text-[8px] font-bold uppercase tracking-widest text-neutral-500 leading-tight">
                    {userProfile?.country || 'Member'}
                  </span>
                </div>
                <button 
                  onClick={() => logout()}
                  className="flex items-center gap-2 p-1.5 hover:bg-neutral-900 text-neutral-500 hover:text-white rounded-lg transition-all group active:scale-95"
                  title={user.email || 'Logout'}
                >
                  {user.photoURL ? (
                    <img referrerPolicy="no-referrer" src={user.photoURL} className="w-6 h-6 rounded-full border border-neutral-800 group-hover:border-amber-500 transition-colors" alt="" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center group-hover:border-amber-500 transition-colors">
                      <span className="text-[10px] font-black text-amber-500">
                        {(userProfile?.displayName || user.displayName || '?')[0].toUpperCase()}
                      </span>
                    </div>
                  )}
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className={cn(
        song ? "pt-16" : "pt-10",
        "pb-32 px-4 transition-all duration-300 mx-auto overflow-x-hidden touch-pan-y overscroll-x-none",
        song ? "w-full max-w-xl" : "max-w-5xl"
      )}>
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-8 h-8 border-2 border-amber-500/10 border-t-amber-500 rounded-full animate-spin" / >
            <p className="text-[10px] uppercase tracking-[3px] text-neutral-600">Retrieving from AI Library</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/5 border border-red-500/20 text-red-500 text-[10px] uppercase tracking-widest py-3 px-4 rounded text-center mb-12">
            {error}
          </div>
        )}

        {!song && !loading && (
          <div className="space-y-4 pt-6">
            <div className="text-center pt-2 pb-6">
              <h1 className="text-5xl font-black text-white tracking-tighter uppercase italic leading-none py-1">Chordstream</h1>
              <p className="text-[10px] text-red-600 font-black tracking-[0.3em] uppercase mt-1 mb-8">Your Ultimate Songbook</p>

              <form onSubmit={handleSearch} className="max-w-md mx-auto relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  <Search className="w-4 h-4 text-neutral-600 group-focus-within:text-amber-500 transition-colors" / >
                </div>
                <input
                   type="text"
                  placeholder="Search Songs or Artists..."
                    value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full bg-neutral-900/50 hover:bg-neutral-900 border-2 border-neutral-800 rounded-xl py-2 pl-11 pr-24 focus:outline-none focus:border-amber-500 focus:bg-neutral-900 transition-all placeholder:text-neutral-500 text-sm text-white shadow-lg"
                / >
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {query && (
                    <button 
                       type="button"
                       onClick={() => setQuery('')}
                       className="p-1 text-neutral-500 hover:text-white hover:bg-neutral-800 rounded-lg transition-all"
                    >
                      <X className="w-3.5 h-3.5" / >
                    </button>
                  )}
                  <button 
                     disabled={loading}
                     type="submit"
                    className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-[9px] font-black uppercase tracking-widest rounded-lg transition-all shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50"
                  >
                    Search
                  </button>
                </div>
              </form>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-amber-500" / >
                    <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Search Results</h2>
                  </div>
                  <button onClick={() => setSearchResults([])} className="text-[8px] text-neutral-600 uppercase font-black hover:text-white">Clear</button>
                </div>
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg overflow-hidden">
                  {searchResults.map((res, idx) => {
                    const isFav = displayLibrary.some(l => l.title === res.title && l.artist === res.artist);
                    const resKey = `search-${res.artist}-${res.title}-${idx}`;
                    return (
                      <div 
                         key={resKey} 
                        className="group flex items-center justify-between p-2 border-b border-amber-500/10 last:border-0 hover:bg-amber-500/10 transition-colors cursor-pointer"
                         onClick={() => handleSearch(undefined, `${res.artist} - ${res.title}`)}
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-3">
                          <Music className="w-3 h-3 text-amber-500/40 shrink-0" / >
                          <div className="truncate">
                            <span className="font-bold text-white text-[11px] mr-2">{res.title}</span>
                            <span className="text-[9px] text-neutral-500 uppercase tracking-wider">{res.artist}</span>
                          </div>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (savingId === `${res.artist}-${res.title}`) return;
                            isFav ? handleUnsaveSong(res.artist, res.title) : handleSaveSong(res);
                          }}
                          className="p-2 transition-all"
                        >
                           {isFav ? (
                             <Heart className="w-3.5 h-3.5 text-amber-500 fill-amber-500" / >
                           ) : (
                             savingId === `${res.artist}-${res.title}` ? (
                               <RotateCcw className="w-3.5 h-3.5 text-amber-500 animate-spin" / >
                             ) : (
                               <Plus className={cn("w-3.5 h-3.5 transition-colors", "text-amber-500/40 hover:text-amber-500")} / >
                             )
                           )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {displayLibrary && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <Heart className="w-3.5 h-3.5 text-amber-500 fill-amber-500" / >
                    <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">{user ? "My Library" : "Guest Library"}</h2>
                  </div>
                  <span className="text-[8px] text-neutral-600 uppercase font-bold">{displayLibrary.length} tracks</span>
                </div>
                
                {displayLibrary.length > 0 ? (
                  <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg overflow-hidden max-h-[250px] overflow-y-auto">
                    {displayLibrary.map((ps) => (
                      <div 
                         key={ps.id} 
                        className="group flex items-center justify-between p-1.5 px-3 border-b border-neutral-800/20 last:border-0 hover:bg-neutral-800/50 transition-colors cursor-pointer"
                         onClick={() => selectPreloaded(ps)}
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-2.5">
                          <Music className="w-3.5 h-3.5 text-neutral-700 shrink-0" / >
                          <div className="flex-1 min-w-0 flex items-baseline gap-2 truncate">
                            <div className="font-black text-sm text-white truncate leading-tight group-hover:text-amber-400 transition-colors uppercase italic">{ps.title}</div>
                            <div className="text-[9px] text-neutral-500 uppercase tracking-tighter font-black shrink-0">{ps.artist}</div>
                          </div>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteSong(ps.id); }}
                          className="p-1 px-3 text-neutral-800 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                        >
                          <Trash2 className="w-4 h-4" / >
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-neutral-900/10 border border-[#222] border-dashed rounded-xl py-8 text-center px-4">
                    <p className="text-[9px] text-neutral-600 uppercase tracking-widest leading-relaxed">
                      Your personal library is empty
                    </p>
                  </div>
                )}
              </div>
            )}

            {recommendations.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" / >
                    <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">AI Suggestions</h2>
                  </div>
                  <button 
                    onClick={handleRefreshRecs}
                    disabled={isRefreshingRecs || loadingRecs}
                    className="text-[8px] text-neutral-600 uppercase font-black hover:text-amber-500 transition-colors flex items-center gap-1 active:scale-95 disabled:opacity-50"
                  >
                    <RotateCcw className={cn("w-2.5 h-2.5", isRefreshingRecs && "animate-spin")} / >
                    Refresh
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {recommendations.slice(0, 8).map((rec, idx) => (
                    <div 
                      key={`rec-${idx}`} 
                      className="group flex items-center justify-between p-2.5 bg-neutral-900/40 border border-neutral-800/50 rounded-xl hover:bg-neutral-800/80 hover:border-amber-500/20 transition-all cursor-pointer"
                      onClick={() => handleSearch(undefined, `${rec.artist} - ${rec.title}`)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[11px] text-white truncate leading-tight uppercase italic group-hover:text-amber-500 transition-colors">{rec.title}</div>
                        <div className="text-[8px] text-neutral-500 uppercase tracking-widest font-black truncate">{rec.artist}</div>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveSong(rec);
                        }}
                        className="p-1.5 text-neutral-700 hover:text-amber-500 transition-colors active:scale-110"
                      >
                        <Heart className="w-3.5 h-3.5" / >
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!user && (
              <div className="mt-12 p-8 bg-amber-500 rounded-3xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform duration-500">
                  <Zap className="w-24 h-24 text-black" / >
                </div>
                <div className="relative z-10">
                  <h3 className="text-2xl font-black text-black uppercase tracking-tighter mb-2 italic">Sync across devices</h3>
                  <p className="text-black/70 text-xs font-bold uppercase tracking-widest mb-6 max-w-xs leading-relaxed">
                    Create an account to save your library forever and access it from anywhere.
                  </p>
                  <button 
                    onClick={handleLogin}
                    className="px-6 py-3 bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-900 transition-all active:scale-95 shadow-xl"
                  >
                    Join Now Free
                  </button>
                </div>
              </div>
            )}

            {/* Featured Section (fallback or static) */}
            <div className="mt-16">
              <div className="flex items-center gap-2 mb-6 px-2">
                <div className="w-1 h-1 bg-amber-500 rounded-full" / >
                <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-neutral-500">Featured Classics</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {PRELOADED_SONGS.map((ps, idx) => (
                  <button
                    key={idx}
                    onClick={() => selectPreloaded(ps)}
                    className="flex flex-col items-start p-3 bg-neutral-900/30 border border-neutral-800 rounded-xl hover:bg-neutral-800/60 hover:border-neutral-700 transition-all text-left active:scale-95"
                  >
                    <span className="text-[10px] font-black text-white uppercase italic truncate w-full mb-0.5">{ps.title}</span>
                    <span className="text-[8px] font-bold text-neutral-500 uppercase tracking-widest truncate w-full">{ps.artist}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {song && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <header className="relative py-12 px-4 text-center overflow-hidden rounded-3xl mb-4">
              <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-3xl" / >
              <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 to-transparent" / >
              
              <div className="relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full mb-6">
                  <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" / >
                  <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest italic">AI Generated Sheet</span>
                </div>
                
                <h2 className="text-4xl md:text-6xl font-black text-white tracking-tighter uppercase italic leading-none mb-3 drop-shadow-2xl">{song.title}</h2>
                <p className="text-sm md:text-lg font-black text-amber-500 uppercase tracking-[0.3em] mb-8 italic">{song.artist}</p>

                <div className="flex flex-wrap justify-center items-center gap-3">
                   <div className="flex items-center gap-1.5 px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-lg border border-white/5 shadow-xl">
                    <span className="text-[8px] font-black text-neutral-500 uppercase tracking-widest">Key:</span>
                    <span className="text-xs font-black text-white uppercase">{transposeChord(song.originalKey, keyOffset)}</span>
                   </div>
                   <div className="flex items-center gap-1.5 px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-lg border border-white/5 shadow-xl">
                    <span className="text-[8px] font-black text-neutral-500 uppercase tracking-widest">Tempo:</span>
                    <span className="text-xs font-black text-white">{currentTempo || 120} <span className="text-[8px] text-neutral-500 uppercase">BPM</span></span>
                   </div>
                </div>
              </div>
            </header>

            {/* Quick Chord Guide */}
            <div className="flex flex-wrap gap-2 items-center print:hidden chord-guide-print-hide">
              <span className="text-[8px] font-black uppercase tracking-widest text-neutral-500 mr-2">Chords:</span>
              {Array.from(new Set(song.sections.flatMap(s => s.lines.flatMap(l => {
                const match = l.match(/\[([A-G][#b]?[^\]]*)\]/g);
                return match ? match.map(m => transposeChord(m.slice(1, -1).trim(), keyOffset)) : [];
              })))).filter(Boolean).map((c: any) => (
                <button 
                  key={`guide-${c}`}
                  onClick={() => handleChordClick(c as string)}
                  className="px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-[#222] rounded text-[10px] font-bold text-amber-500 transition-colors uppercase"
                >
                  {c as string}
                </button>
              ))}
            </div>

            {/* Strumming Suggestion */}
            {isStrummingEnabled && song.strummingPattern && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Music className="w-8 h-8 text-amber-500" />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 bg-amber-500/20 rounded-lg">
                    <Music className="w-3 h-3 text-amber-500" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">Suggested Strumming</span>
                </div>
                <p className="text-sm font-black text-white italic tracking-tight">
                  {song.strummingPattern}
                </p>
              </motion.div>
            )}

            {/* Song Grid - More compact */}
            <div className="space-y-2 song-container-print">
              {song.sections.map((section, sIdx) => (
                <div key={sIdx} className="space-y-0.5">
                  <h3 className="text-[8px] font-black text-amber-500/30 uppercase tracking-[0.4em] pt-4 mb-1 section-header-print">
                    {section.name}
                  </h3>
                  <div className="space-y-0">
                    {section.lines.map((line, lIdx) => (
                      <LineRenderer 
                        key={lIdx} 
                        line={transposeLine(line, keyOffset)} 
                        fontSize={fontSize}
                        isIntro={section.name.toLowerCase().includes('intro') || section.name.toLowerCase().includes('instrumental')}
                        onChordClick={handleChordClick}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-12 text-center p-8 bg-neutral-900/30 rounded-3xl border border-neutral-900 border-dashed print:hidden">
               <Music className="w-8 h-8 text-neutral-800 mx-auto mb-4" / >
               <p className="text-[8px] text-neutral-600 uppercase font-black tracking-[0.3em]">End of Song</p>
            </div>
          </motion.div>
        )}
      </main>

      {/* Toolbars */}
      <AnimatePresence>
        {song && (
          <>
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 print:hidden"
            >
              <div className="bg-neutral-950/90 backdrop-blur-2xl border border-white/10 rounded-2xl p-1.5 flex items-center gap-1 shadow-2xl shadow-black/50">
                <button
                  onClick={() => setIsScrolling(!isScrolling)}
                  className={cn(
                    "flex items-center gap-2 px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95",
                    isScrolling 
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/20" 
                      : "bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                  )}
                >
                  {isScrolling ? <Pause className="w-4 h-4" / > : <Play className="w-4 h-4 fill-current" / >}
                  <span>{isScrolling ? 'Stop' : 'Autoscroll'}</span>
                </button>

                <div className="w-px h-8 bg-white/10 mx-1" / >

                <button
                  onClick={() => setKeyOffset(prev => prev - 1)}
                  className="p-3 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white rounded-xl transition-all"
                  title="Transpose Down"
                >
                  <Minus className="w-4 h-4" / >
                </button>
                <button
                  onClick={() => setKeyOffset(0)}
                  className="px-3 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl transition-all font-black text-[10px] uppercase"
                  title="Reset Key"
                >
                  Key
                </button>
                <button
                  onClick={() => setKeyOffset(prev => prev + 1)}
                  className="p-3 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white rounded-xl transition-all"
                  title="Transpose Up"
                >
                  <Plus className="w-4 h-4" / >
                </button>

                <div className="w-px h-8 bg-white/10 mx-1" / >

                <button
                   onClick={handlePrint}
                  className="p-3 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white rounded-xl transition-all"
                  title="Print / Save PDF"
                >
                  <Printer className="w-4 h-4" / >
                </button>

                <div className="w-px h-8 bg-white/10 mx-1" / >
                
                <button
                  onClick={() => {
                    const isFav = displayLibrary.some(l => l.title === song.title && l.artist === song.artist);
                    isFav ? handleUnsaveSong(song.artist, song.title) : handleSaveSong(song);
                  }}
                  className="p-3 bg-neutral-900 hover:bg-neutral-800 rounded-xl transition-all"
                  title="Save to Favorites"
                >
                   <Heart className={cn("w-4 h-4", 
                     displayLibrary.some(l => l.title === song.title && l.artist === song.artist) 
                       ? "text-amber-500 fill-amber-500" 
                       : "text-neutral-400"
                   )} / >
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Settings Panel Overlay */}
      <AnimatePresence>
        {isSettingsOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-80 bg-neutral-950 border-l border-[#222] z-[60] shadow-2xl p-6 pb-40 overflow-y-auto custom-scrollbar flex flex-col"
            >
              <div className="flex items-center justify-between mb-8 shrink-0">
                <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5 text-amber-500" />
                  App Settings
                </h3>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1.5 text-neutral-500 hover:text-white hover:bg-neutral-900 rounded-lg transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6 flex-1 pb-10">
                {/* User Info Section */}
                {user && (
                  <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                        {user.photoURL ? (
                          <img src={user.photoURL} className="w-full h-full rounded-xl object-cover" alt="" />
                        ) : (
                          <span className="text-xl font-black text-amber-500">
                            {(userProfile?.displayName || user.displayName || '?')[0].toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-black text-white uppercase italic truncate">
                          {userProfile?.displayName || user.displayName || 'Guest User'}
                        </h4>
                        <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold truncate">
                          {userProfile?.email || user.email || 'Anonymous'}
                        </p>
                      </div>
                    </div>
                    {userProfile?.country && (
                      <div className="flex items-center justify-between py-2 border-t border-white/5">
                        <span className="text-[8px] font-black uppercase tracking-widest text-neutral-600">Location</span>
                        <span className="text-[9px] font-bold text-neutral-400 uppercase">{userProfile.country}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Premium / Subscription Section */}
                <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 overflow-hidden relative group">
                  <div className="absolute top-0 right-0 p-2 opacity-10">
                    <Zap className="w-8 h-8 text-amber-500" />
                  </div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-4 flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-amber-500" />
                    Membership
                  </h4>

                  <div className="mb-4">
                    {userProfile?.isSubscribed ? (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest">Active Plan</p>
                          {userProfile.renewalDate && (
                            <p className="text-[8px] font-medium text-neutral-500 uppercase">
                              Renews {new Date(userProfile.renewalDate?.seconds ? userProfile.renewalDate.seconds * 1000 : userProfile.renewalDate).toLocaleDateString()}
                            </p>
                          )}
                          {userProfile.subscriptionType === 'lifetime' && (
                            <p className="text-[8px] font-medium text-neutral-500 uppercase tracking-tighter">Forever Access</p>
                          )}
                        </div>
                        <p className="text-xs text-white capitalize">
                          Premium {userProfile.subscriptionType || 'Monthly'}
                        </p>
                      </div>
                    ) : (
                      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Current Plan</p>
                        <p className="text-xs text-white">Free Version</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {userProfile?.isSubscribed ? (
                      <button 
                        onClick={handleCreatePortalSession}
                        disabled={isProcessingPayment}
                        className="w-full py-2.5 bg-neutral-800 hover:bg-neutral-700 text-amber-500 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all border border-neutral-700 active:scale-[0.98] cursor-pointer"
                      >
                        Manage Billing & Cancel
                      </button>
                    ) : (
                      <button 
                        onClick={() => setShowPaywall(true)}
                        className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all shadow-lg shadow-red-500/20 active:scale-[0.98] cursor-pointer"
                      >
                        Upgrade to Premium
                      </button>
                    )}
                  </div>
                </div>

                {/* Stats Section */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4">
                    <p className="text-[8px] font-black uppercase tracking-widest text-neutral-500 mb-1">Favorites</p>
                    <p className="text-lg font-black text-white">{displayLibrary.length}/5</p>
                  </div>
                  <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4">
                    <p className="text-[8px] font-black uppercase tracking-widest text-neutral-500 mb-1">Prints</p>
                    <p className="text-lg font-black text-white">{userProfile?.printCount || 0}/5</p>
                  </div>
                </div>

                {/* Display Section */}
                <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-400 flex items-center gap-1.5">
                    <Music className="w-3 h-3 text-amber-500" />
                    Display
                  </h4>
                  
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Text Size</span>
                        <span className="text-xs font-mono text-white">{fontSize}px</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setFontSize(Math.max(10, fontSize - 1))} className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-white transition-colors"><Minus className="w-4 h-4" /></button>
                        <input type="range" min="10" max="30" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="flex-1 accent-amber-500" />
                        <button onClick={() => setFontSize(Math.min(30, fontSize + 1))} className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-white transition-colors"><Plus className="w-4 h-4" /></button>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Scroll Speed</span>
                        <span className="text-xs font-mono text-white">{scrollSpeed}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setScrollSpeed(Math.max(5, scrollSpeed - 5))} className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-white transition-colors"><ArrowDown className="w-4 h-4" /></button>
                        <input type="range" min="5" max="100" step="5" value={scrollSpeed} onChange={(e) => setScrollSpeed(parseInt(e.target.value))} className="flex-1 accent-amber-500" />
                        <button onClick={() => setScrollSpeed(Math.min(100, scrollSpeed + 5))} className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-white transition-colors"><ArrowUp className="w-4 h-4" /></button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-neutral-800/30 rounded-lg border border-neutral-800">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-white uppercase tracking-widest">Easy Chords</span>
                        <span className="text-[8px] text-neutral-500 uppercase font-bold">Transpose to easy keys</span>
                      </div>
                      <button 
                        onClick={() => {
                          const next = !isEasyMode;
                          setIsEasyMode(next);
                          if (song) {
                            setKeyOffset(next ? getEasyKeyOffset(song.sections) : 0);
                          }
                        }}
                        className={cn(
                          "w-10 h-5 rounded-full relative transition-all duration-300",
                          isEasyMode ? "bg-amber-500" : "bg-neutral-700"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 shadow-sm",
                          isEasyMode ? "left-6" : "left-1"
                        )} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-neutral-800/30 rounded-lg border border-neutral-800">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-white uppercase tracking-widest">Strumming Guide</span>
                        <span className="text-[8px] text-neutral-500 uppercase font-bold">Show suggested patterns</span>
                      </div>
                      <button 
                        onClick={() => setIsStrummingEnabled(!isStrummingEnabled)}
                        className={cn(
                          "w-10 h-5 rounded-full relative transition-all duration-300",
                          isStrummingEnabled ? "bg-amber-500" : "bg-neutral-700"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 shadow-sm",
                          isStrummingEnabled ? "left-6" : "left-1"
                        )} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Stripe Infrastructure Section */}
                {user?.email === 'sunnyhothi43-cmyk' && (
                  <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-400 flex items-center gap-1.5">
                        <Info className="w-3 h-3 text-amber-500" />
                        Infrastructure
                      </h4>
                    </div>
                    
                    <div className="space-y-3">
                       <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                          <div className="flex items-center justify-between mb-1">
                             <span className="text-[8px] font-black uppercase text-neutral-500">Stripe Status</span>
                             <span className={cn("text-[8px] font-black uppercase", stripeStatus ? "text-green-500" : "text-red-500")}>
                               {stripeStatus ? 'Connected' : 'Offline'}
                             </span>
                          </div>
                          {stripeStatus && (
                            <div className="space-y-1 mt-2">
                              <div className="flex justify-between">
                                <span className="text-[7px] text-neutral-600">Secret Key</span>
                                <span className="text-[7px] text-white">{stripeStatus.secretKeyPrefix}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[7px] text-neutral-600">SK Format</span>
                                <span className={cn("text-[7px]", stripeStatus.isSkPrefix ? "text-green-500" : "text-red-500")}>{stripeStatus.isSkPrefix ? 'Valid' : 'Invalid'}</span>
                              </div>
                            </div>
                          )}
                       </div>
                    </div>
                  </div>
                )}
                
                <button 
                  onClick={() => logout()}
                  className="w-full py-4 bg-neutral-900 hover:bg-red-900/20 text-neutral-500 hover:text-red-500 text-[10px] font-black uppercase tracking-widest rounded-2xl transition-all border border-neutral-800 active:scale-95"
                >
                  Sign Out
                </button>

                <div className="pt-10 text-center space-y-2">
                  <p className="text-[8px] font-black text-neutral-700 uppercase tracking-[0.4em]">Chordstream v1.0.4</p>
                  <p className="text-[7px] font-bold text-neutral-800 uppercase tracking-widest">Built with Gemini AI</p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Paywall Overlay */}
      <AnimatePresence>
        {showPaywall && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[400] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4"
          >
             <motion.div
               initial={{ scale: 0.9, y: 20 }}
               animate={{ scale: 1, y: 0 }}
               className="w-full max-w-lg bg-neutral-950 border border-amber-500/20 rounded-[2.5rem] overflow-hidden shadow-2xl relative"
             >
                {/* Close Button */}
                <button 
                  onClick={() => setShowPaywall(false)}
                  className="absolute top-6 right-6 p-2 bg-white/5 hover:bg-white/10 rounded-full transition-all text-neutral-500 hover:text-white z-20"
                >
                  <X className="w-5 h-5" / >
                </button>

                <div className="relative p-8 md:p-12 text-center">
                  <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full mb-8">
                    <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" / >
                    <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Premium Access Required</span>
                  </div>

                  <h2 className="text-4xl md:text-5xl font-black text-white uppercase italic tracking-tighter leading-none mb-4">
                    Level Up Your <br / ><span className="text-amber-500">Playing</span>
                  </h2>

                  <p className="text-neutral-400 text-sm font-bold uppercase tracking-widest mb-12 leading-relaxed">
                    {paywallReason === 'favorites' 
                      ? "You've reached the free limit of 5 favorites. Upgrade to save unlimited songs."
                      : "Free users are limited to 5 prints. Upgrade to print your entire library."}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    <button 
                      onClick={() => setSelectedPlanId('monthly')}
                      className={cn(
                        "p-6 rounded-3xl border-2 transition-all text-left group",
                        selectedPlanId === 'monthly' ? "bg-amber-500 border-amber-500" : "bg-neutral-900 border-neutral-800 hover:border-neutral-700"
                      )}
                    >
                      <p className={cn("text-[10px] font-black uppercase tracking-widest mb-1", selectedPlanId === 'monthly' ? "text-black/60" : "text-neutral-500")}>Monthly</p>
                      <p className={cn("text-2xl font-black", selectedPlanId === 'monthly' ? "text-black" : "text-white")}>$4.99</p>
                    </button>

                    <button 
                      onClick={() => setSelectedPlanId('yearly')}
                      className={cn(
                        "p-6 rounded-3xl border-2 transition-all text-left relative overflow-hidden group",
                        selectedPlanId === 'yearly' ? "bg-amber-500 border-amber-500" : "bg-neutral-900 border-neutral-800 hover:border-neutral-700"
                      )}
                    >
                      <div className="absolute top-0 right-0 bg-black text-amber-500 text-[7px] font-black px-3 py-1 uppercase tracking-widest rounded-bl-xl">Best Value</div>
                      <p className={cn("text-[10px] font-black uppercase tracking-widest mb-1", selectedPlanId === 'yearly' ? "text-black/60" : "text-neutral-500")}>Annual</p>
                      <p className={cn("text-2xl font-black", selectedPlanId === 'yearly' ? "text-black" : "text-white")}>$29.99</p>
                    </button>
                  </div>

                  <button 
                    onClick={() => handleCreateCheckoutSession(stripeStatus?.priceIds?.[selectedPlanId])}
                    className="w-full py-5 bg-white hover:bg-neutral-200 text-black rounded-2xl font-black uppercase tracking-[0.2em] text-xs transition-all active:scale-[0.98] shadow-2xl mb-6"
                  >
                    Unlock Premium Now
                  </button>

                  <div className="flex items-center justify-center gap-6 opacity-40">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle className="w-3 h-3" / >
                      <span className="text-[8px] font-black uppercase">Unlimited Favorites</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle className="w-3 h-3" / >
                      <span className="text-[8px] font-black uppercase">Unlimited Printing</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle className="w-3 h-3" / >
                      <span className="text-[8px] font-black uppercase">Pro AI Features</span>
                    </div>
                  </div>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chord Modal */}
      <AnimatePresence>
        {selectedChord && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[500] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setSelectedChord(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-neutral-900 border border-white/10 rounded-[2rem] p-8 w-full max-w-sm text-center relative"
              onClick={e => e.stopPropagation()}
            >
              <button 
                onClick={() => setSelectedChord(null)}
                className="absolute top-6 right-6 p-2 text-neutral-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" / >
              </button>

              <div className="mb-6">
                <h3 className="text-4xl font-black text-white uppercase italic tracking-tighter mb-1">{selectedChord.name}</h3>
                <p className="text-[10px] text-amber-500 font-black uppercase tracking-[0.3em]">Chord Diagram</p>
              </div>

              <div className="bg-white/5 rounded-2xl p-6 mb-8 flex flex-col items-center justify-center min-h-[240px]">
                {loadingChord ? (
                  <div className="w-8 h-8 border-2 border-amber-500/10 border-t-amber-500 rounded-full animate-spin" / >
                ) : selectedChord.positions.length > 0 ? (
                  <ChordDiagram 
                    chord={{
                      frets: selectedChord.positions[selectedChord.currentIndex].frets,
                      fingers: selectedChord.positions[selectedChord.currentIndex].fingers,
                      barres: selectedChord.positions[selectedChord.currentIndex].barres || []
                    }}
                  / >
                ) : (
                  <p className="text-neutral-500 text-xs font-bold uppercase tracking-widest">Position not found</p>
                )}
              </div>

              {selectedChord.positions.length > 1 && (
                <div className="flex items-center justify-center gap-4 mb-8">
                  <button 
                    onClick={() => setSelectedChord(prev => prev ? ({ ...prev, currentIndex: (prev.currentIndex - 1 + prev.positions.length) % prev.positions.length }) : null)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-white transition-all active:scale-90"
                  >
                    <Minus className="w-4 h-4" / >
                  </button>
                  <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">
                    Pos {selectedChord.currentIndex + 1} / {selectedChord.positions.length}
                  </span>
                  <button 
                    onClick={() => setSelectedChord(prev => prev ? ({ ...prev, currentIndex: (prev.currentIndex + 1) % prev.positions.length }) : null)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-white transition-all active:scale-90"
                  >
                    <Plus className="w-4 h-4" / >
                  </button>
                </div>
              )}

              <button
                onClick={() => setSelectedChord(null)}
                className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-black rounded-xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 shadow-xl shadow-amber-500/10"
              >
                Got It
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CSS for custom scrollbar and print */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #222;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #333;
        }
        
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          .min-h-screen {
            background: white !important;
          }
          nav, .print\\:hidden, button, .chord-guide-print-hide {
            display: none !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: none !important;
          }
          .song-container-print {
            color: black !important;
          }
          header {
             padding: 20px 0 !important;
             background: transparent !important;
             border-bottom: 2px solid #eee !important;
             border-radius: 0 !important;
          }
          header h2 {
            color: black !important;
            font-size: 24pt !important;
          }
          header p {
            color: #666 !important;
          }
          .section-header-print {
            color: #999 !important;
            border-bottom: 1px solid #eee !important;
            padding-top: 15pt !important;
          }
          .print-instrumental {
             background: #f9f9f9 !important;
             border: 1px solid #eee !important;
          }
        }
      `}</style>
    </div>
  );
}

function LineRenderer({ line, fontSize, isIntro, onChordClick }: { line: string, fontSize: number, isIntro: boolean, onChordClick: (c: string) => any }) {
  const segments = useMemo(() => parseChordSegments(line), [line]);
  
  // Detect if this is an instrumental line (lots of chords, little/no text)
  const chordCount = segments.filter(s => s.chord).length;
  const totalTextLength = segments.reduce((acc, s) => acc + (s.text?.length || 0), 0);
  const isInstrumental = (chordCount > 0 && totalTextLength < 10) || isIntro;

  return (
    <div className={cn(
      "flex flex-wrap items-end leading-none py-1.5 md:py-2",
      isInstrumental && "gap-x-8 py-2 md:py-3 border-y border-neutral-900/50 my-1 md:my-2 bg-neutral-900/10 px-3 rounded print-instrumental"
    )}>
      {segments.map((seg, i) => (
        <div key={i} className={cn("relative flex flex-col", !isInstrumental && "mr-[0.1em]")}>
          {seg.chord && (
            <button 
              onClick={() => onChordClick(seg.chord!)}
              className={cn(
                "font-black text-amber-500 hover:text-amber-400 transition-colors uppercase select-none",
                isInstrumental && "print:pt-0" // Instrumental lines in print use top-level padding
              )}
              style={{ 
                fontSize: `${fontSize * (isInstrumental ? 1.1 : 0.8)}px`,
                marginBottom: isInstrumental ? '0' : '0.1em'
              }}
            >
              {seg.chord}
            </button>
          )}
          <span 
            className={cn(
              "text-white/90 whitespace-pre font-medium",
              isInstrumental ? "text-base" : ""
            )}
            style={{ fontSize: `${fontSize}px` }}
          >
            {seg.text || (seg.chord && !isInstrumental ? " " : "")}
          </span>
        </div>
      ))}
    </div>
  );
}
