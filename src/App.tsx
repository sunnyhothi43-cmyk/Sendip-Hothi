import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Music, Settings, ArrowUp, ArrowDown, Play, Pause, RotateCcw, Minus, Plus, Home, X, Printer, LogIn, LogOut, Heart, Trash2, Sparkles, Info, Zap, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchSongData, SongData, fetchRecommendations, searchSongs, fetchChordFingering } from './services/geminiService';
import { transposeLine, parseChordSegments, getEasyKeyOffset, transposeChord } from './lib/musicUtils';
import { cn } from './lib/utils';
import { PRELOADED_SONGS } from './lib/preloadedSongs';
import { auth, loginWithGoogle, logout, db, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query as fsQuery, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, orderBy, DocumentData, getDoc, setDoc, increment, updateDoc } from 'firebase/firestore';
import { CHORD_LIBRARY, ChordPosition } from './lib/chordLibrary';
import { ChordDiagram } from './components/ChordDiagram';

interface LibrarySong extends SongData {
  id: string;
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
  const [selectedChord, setSelectedChord] = useState<{ name: string; positions: ChordPosition[]; currentIndex: number } | null>(null);
  const [loadingChord, setLoadingChord] = useState(false);
  const [userProfile, setUserProfile] = useState<{ favoritesCount: number; printCount: number; isSubscribed: boolean } | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallReason, setPaywallReason] = useState<'favorites' | 'print'>('favorites');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Fetch user profile
  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      return;
    }

    const unsubs = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setUserProfile(snapshot.data() as any);
      } else {
        const initialProfile = {
          favoritesCount: 0,
          printCount: 0,
          isSubscribed: false,
          updatedAt: serverTimestamp()
        };
        setDoc(doc(db, 'users', user.uid), initialProfile);
        setUserProfile(initialProfile as any);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`));

    return () => unsubs();
  }, [user]);

  const handleCreateCheckoutSession = async (priceId: string) => {
    if (!user) {
      setError("Please sign in to subscribe");
      return;
    }
    setIsProcessingPayment(true);
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
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || "Failed to create checkout session");
      }
    } catch (error: any) {
      console.error("Payment error:", error);
      setError(error.message);
    } finally {
      setIsProcessingPayment(false);
    }
  };

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

  const resetScroll = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setIsScrolling(false);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-[#E0E0E0] font-sans selection:bg-amber-500/30">
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
      <nav className="fixed top-0 left-0 right-0 z-50 bg-neutral-950/95 border-b border-[#222] p-2">
        <div className="max-w-5xl mx-auto flex items-center gap-2">
          <button 
            onClick={goHome}
            className="flex items-center gap-2 px-3 py-1.5 bg-amber-500 rounded font-black text-black uppercase tracking-widest text-[10px] hover:bg-amber-400 transition-all shadow-lg shadow-amber-500/20"
          >
            <Home className="w-3.5 h-3.5" />
            <span className="hidden xs:block">Home</span>
          </button>
          
          <form onSubmit={handleSearch} className="flex-1 relative">
            <input
              type="text"
              placeholder="Type Artist - Song and press Enter..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-neutral-900 border border-[#333] rounded py-1.5 pl-3 pr-16 focus:outline-none focus:border-amber-500 transition-all placeholder:text-neutral-600 text-xs text-white"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {query && (
                <button 
                  type="button"
                  onClick={() => setQuery('')}
                  className="p-1 text-neutral-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button 
                disabled={loading}
                className="p-1 text-amber-500"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          </form>

          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="p-1.5 bg-neutral-900 border border-[#333] rounded transition-colors text-white hover:border-amber-500/50"
          >
            <Settings className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-[#222] mx-1" />

          {user ? (
            <button 
              onClick={() => logout()}
              className="flex items-center gap-1.5 p-1.5 hover:bg-neutral-900 text-neutral-500 hover:text-white rounded transition-all"
              title={user.email || 'Logout'}
            >
              <img src={user.photoURL || ''} className="w-4 h-4 rounded-full" alt="" />
              <LogOut className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button 
              onClick={() => loginWithGoogle()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 border border-[#333] rounded font-black text-white uppercase tracking-widest text-[9px] hover:bg-neutral-800 transition-all"
            >
              <LogIn className="w-3 h-3 text-amber-500" />
              <span>Login</span>
            </button>
          )}
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
            <div className="w-8 h-8 border-2 border-amber-500/10 border-t-amber-500 rounded-full animate-spin" />
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
            <div className="text-center pt-2 pb-2">
              <h1 className="text-4xl font-black text-white tracking-tighter uppercase italic leading-none py-1">Chordstream</h1>
              <p className="text-[10px] text-red-600 font-black tracking-[0.3em] uppercase mt-1">Your Ultimate Songbook</p>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-amber-500" />
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
                          <Music className="w-3 h-3 text-amber-500/40 shrink-0" />
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
                            <Heart className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                          ) : (
                            savingId === `${res.artist}-${res.title}` ? (
                              <RotateCcw className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                            ) : (
                              <Plus className={cn("w-3.5 h-3.5 transition-colors", "text-amber-500/40 hover:text-amber-500")} />
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
                    <Heart className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
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
                          <Music className="w-3.5 h-3.5 text-neutral-700 shrink-0" />
                          <div className="flex-1 min-w-0 flex items-baseline gap-2 truncate">
                            <div className="font-black text-sm text-white truncate leading-tight group-hover:text-amber-400 transition-colors uppercase italic">{ps.title}</div>
                            <div className="text-[9px] text-neutral-500 uppercase tracking-tighter font-black shrink-0">{ps.artist}</div>
                          </div>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteSong(ps.id); }}
                          className="p-1 px-3 text-neutral-800 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                        >
                          <Trash2 className="w-4 h-4" />
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

            {/* Combined Discover Section (Classics + AI Suggestions) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <Music className="w-3.5 h-3.5 text-neutral-500" />
                  <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-neutral-400">Discover</h2>
                </div>
                <div className="flex items-center gap-2">
                  {loadingRecs && <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />}
                </div>
              </div>

              <div className="flex items-center justify-between px-3 py-1 border-b border-neutral-800 bg-neutral-950/30">
                <span className="text-[8px] font-black uppercase tracking-widest text-neutral-500">Suggested for you</span>
                <button 
                  onClick={handleRefreshRecs}
                  disabled={isRefreshingRecs || loadingRecs}
                  className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-tight text-amber-500 hover:text-amber-400 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className={cn("w-2 h-2", (isRefreshingRecs || loadingRecs) && "animate-spin")} />
                  Refresh
                </button>
              </div>

              <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg overflow-hidden max-h-[500px] overflow-y-auto shadow-inner">
                {/* AI Recommendations */}
                {recommendations && recommendations.length > 0 ? (
                  recommendations
                    .filter(rec => !displayLibrary.some(l => 
                      l.title.toLowerCase().trim() === rec.title.toLowerCase().trim() &&
                      l.artist.toLowerCase().trim() === rec.artist.toLowerCase().trim()
                    ))
                    .map((rec, idx) => {
                    const recKey = `rec-${rec.artist}-${rec.title}-${idx}`;
                    return (
                      <div 
                        key={recKey} 
                        className="group flex items-center justify-between p-1.5 px-3 border-b border-neutral-800/20 hover:bg-neutral-800/50 transition-colors cursor-pointer"
                        onClick={() => handleSearch(undefined, `${rec.artist} - ${rec.title}`)}
                      >
                          <div className="flex-1 min-w-0 flex items-center gap-3">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <div className="truncate flex items-baseline gap-2">
                              <div className="font-black text-sm text-white truncate leading-tight group-hover:text-red-500 transition-colors uppercase italic">{rec.title}</div>
                              <div className="text-[9px] text-neutral-500 uppercase tracking-tighter font-black shrink-0">{rec.artist}</div>
                            </div>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (savingId === `${rec.artist}-${rec.title}`) return;
                              handleSaveSong(rec);
                            }}
                            className="p-1 px-3 hover:scale-110 transition-transform text-neutral-600 hover:text-amber-500"
                          >
                            {savingId === `${rec.artist}-${rec.title}` ? (
                               <RotateCcw className="w-4 h-4 text-amber-500 animate-spin" />
                            ) : (
                               <Plus className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      );
                    })
                ) : !loadingRecs && (
                   <div className="p-6 text-center text-neutral-600 text-[10px] uppercase tracking-widest font-bold">
                     No suggestions available. Click refresh to load some!
                   </div>
                )}

                {/* Preloaded Classics */}
                {PRELOADED_SONGS
                  .filter(ps => !displayLibrary.some(lib => 
                    lib.title.toLowerCase().trim() === ps.title.toLowerCase().trim() &&
                    lib.artist.toLowerCase().trim() === ps.artist.toLowerCase().trim()
                  ))
                  .sort((a, b) => {
                    const artistComp = a.artist.localeCompare(b.artist);
                    if (artistComp !== 0) return artistComp;
                    return a.title.localeCompare(b.title);
                  })
                  .map((ps, idx) => {
                    const classicKey = `classic-${ps.artist}-${ps.title}-${idx}`;
                    return (
                      <div 
                        key={classicKey} 
                        className="group flex items-center justify-between p-1.5 px-3 border-b border-neutral-800/20 last:border-0 hover:bg-neutral-800/50 transition-colors cursor-pointer"
                        onClick={() => selectPreloaded(ps as any)}
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-3">
                          <Music className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                          <div className="flex-1 min-w-0 flex items-baseline gap-2 truncate">
                            <div className="font-black text-sm text-white truncate leading-tight group-hover:text-amber-400 transition-colors uppercase italic">{ps.title}</div>
                            <div className="text-[9px] text-neutral-500 uppercase tracking-tighter font-black shrink-0">{ps.artist}</div>
                          </div>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (savingId === `${ps.artist}-${ps.title}`) return;
                            handleSaveSong(ps);
                          }}
                          className="p-1 px-3 hover:scale-110 transition-transform text-neutral-600 hover:text-amber-500"
                        >
                          {savingId === `${ps.artist}-${ps.title}` ? (
                             <RotateCcw className="w-4 h-4 text-amber-500 animate-spin" />
                          ) : (
                             <Plus className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>

            
            {!user && (
              <div className="text-center py-16 bg-neutral-900/30 rounded-xl border border-[#222] border-dashed">
                <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-6 font-bold">Access your personal library anywhere</p>
                <button 
                  onClick={() => loginWithGoogle()}
                  className="px-8 py-3 bg-amber-500 text-black font-black uppercase tracking-widest text-[10px] rounded hover:bg-amber-400 transition-all shadow-xl shadow-amber-500/10"
                >
                  Sign in with Google
                </button>
              </div>
            )}
          </div>
        )}

        {song && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cn(
              "space-y-6",
              (() => {
                const totalLines = song.sections.reduce((acc, s) => acc + s.lines.length + 1, 0);
                if (totalLines > 80) return "print:text-[7pt] print-tight";
                if (totalLines > 60) return "print:text-[8pt] print-tight";
                if (totalLines > 40) return "print:text-[9.5pt]";
                return "print:text-[11pt]";
              })()
            )}
          >
            <header className="flex justify-between items-center border-b border-[#222] pb-4 print:pb-1 print:mb-1">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2 className="text-2xl font-black text-white print:text-black uppercase italic">{song.title}</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-red-500 uppercase tracking-widest">{song.artist}</span>
                  <button 
                    onClick={() => {
                      const isFav = displayLibrary.some(s => s.title === song.title && s.artist === song.artist);
                      isFav ? handleUnsaveSong(song.artist, song.title) : handleSaveSong(song);
                    }}
                    disabled={isSaving}
                    className={cn(
                      "p-1.5 rounded-full transition-all shadow-lg print:hidden",
                      displayLibrary.some(s => s.title === song.title && s.artist === song.artist) 
                        ? "bg-amber-500 text-black" 
                        : "bg-neutral-800 text-neutral-400 hover:text-amber-500"
                    )}
                  >
                    <Heart className={cn("w-4 h-4", displayLibrary.some(s => s.title === song.title && s.artist === song.artist) && "fill-current")} />
                  </button>
                </div>
              </div>
              <div className="text-right flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      const next = !isEasyMode;
                      setIsEasyMode(next);
                      if (song) setKeyOffset(next ? getEasyKeyOffset(song.sections) : 0);
                    }}
                    className={cn(
                      "text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border transition-all",
                      isEasyMode 
                        ? "bg-amber-500 border-amber-500 text-black shadow-[0_0_10px_rgba(245,158,11,0.3)]" 
                        : "bg-neutral-900 border-[#333] text-neutral-500 hover:text-amber-500"
                    )}
                  >
                    Easy
                  </button>
                  <span className="text-[10px] font-bold text-amber-500 px-2 py-0.5 bg-neutral-900 border border-[#333] rounded">
                    {song.originalKey} ({keyOffset >= 0 ? `+${keyOffset}` : keyOffset})
                  </span>
                </div>
                <span className="text-[9px] text-neutral-600 uppercase font-mono">{currentTempo} BPM</span>
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
          </motion.div>
        )}
      </main>

      {/* Control Sidebar */}
      <AnimatePresence>
        {selectedChord && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedChord(null)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100]"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-64 bg-neutral-950 border border-[#333] rounded-2xl p-6 z-[101] shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex flex-col">
                  <h3 className="text-2xl font-black text-amber-500">{selectedChord.name}</h3>
                  <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold">Chord Diagram</p>
                </div>
                <button 
                  onClick={() => setSelectedChord(null)}
                  className="p-1 text-neutral-500 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex justify-center py-4 relative group">
                {loadingChord ? (
                  <div className="w-[120px] h-[120px] flex items-center justify-center bg-neutral-900/50 rounded-lg border border-neutral-800">
                    <RotateCcw className="w-6 h-6 text-amber-500 animate-spin" />
                  </div>
                ) : selectedChord.positions.length > 0 ? (
                  <div className="flex flex-col items-center">
                    <ChordDiagram position={selectedChord.positions[selectedChord.currentIndex]} size={160} />
                    
                    {selectedChord.positions.length > 1 && (
                      <div className="flex items-center gap-3 mt-4">
                        <button 
                          onClick={() => setSelectedChord(prev => prev ? { ...prev, currentIndex: (prev.currentIndex - 1 + prev.positions.length) % prev.positions.length } : null)}
                          className="p-2 bg-neutral-900 border border-[#333] rounded-full hover:bg-neutral-800 text-white transition-all shadow-lg active:scale-95"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest font-black">
                          {selectedChord.currentIndex + 1} / {selectedChord.positions.length}
                        </span>
                        <button 
                          onClick={() => setSelectedChord(prev => prev ? { ...prev, currentIndex: (prev.currentIndex + 1) % prev.positions.length } : null)}
                          className="p-2 bg-neutral-900 border border-[#333] rounded-full hover:bg-neutral-800 text-white transition-all shadow-lg active:scale-95"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-[120px] h-[120px] flex items-center justify-center bg-neutral-900/50 rounded-lg border border-neutral-800 p-4 text-center">
                    <p className="text-[10px] text-neutral-600 uppercase tracking-widest font-bold leading-relaxed">Fingering not found for this variation</p>
                  </div>
                )}
              </div>

              <div className="mt-8 pt-4 border-t border-[#222]">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="w-3 h-3 text-neutral-500" />
                  <p className="text-[9px] text-neutral-500 uppercase font-black tracking-widest">Guide</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[8px] text-neutral-600 uppercase font-bold tracking-tighter">Strings (L to R)</p>
                    <p className="text-[10px] font-mono text-neutral-400">E A D G B e</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] text-neutral-600 uppercase font-bold tracking-tighter">Fingers</p>
                    <p className="text-[10px] font-mono text-neutral-400">1: Index, 2: Mid</p>
                    <p className="text-[10px] font-mono text-neutral-400">3: Ring, 4: Pinky</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}

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
              className="fixed right-0 top-0 bottom-0 w-72 bg-neutral-950 border-l border-[#222] z-[60] shadow-2xl p-8"
            >
              <div className="flex items-center justify-between mb-10">
                <h3 className="text-xs font-black uppercase tracking-widest text-white">Config</h3>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1 text-neutral-500 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-8">
                {/* Premium / Subscription Section */}
                <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-4 overflow-hidden relative group">
                  <div className="absolute top-0 right-0 p-2 opacity-10">
                    <Zap className="w-8 h-8 text-amber-500" />
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-[10px] font-black text-white uppercase italic leading-tight">
                        {userProfile?.isSubscribed ? 'Premium Active' : 'Free Trial'}
                      </div>
                      <div className="text-[8px] text-neutral-500 uppercase tracking-tighter">
                        {userProfile?.isSubscribed 
                          ? 'Unlimited Access' 
                          : `${Math.max(0, 5 - displayLibrary.length)} slots remaining`}
                      </div>
                    </div>
                    {!userProfile?.isSubscribed && (
                      <div className="px-1.5 py-0.5 bg-red-500/10 rounded text-red-500 text-[7px] font-black uppercase tracking-widest border border-red-500/20">
                        Trial
                      </div>
                    )}
                  </div>

                  {!userProfile?.isSubscribed && (
                    <button 
                      onClick={() => setShowPaywall(true)}
                      className="w-full py-2 bg-red-600 hover:bg-red-700 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all shadow-lg shadow-red-500/20 active:scale-[0.98] cursor-pointer"
                    >
                      Upgrade To Pro
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center bg-neutral-900 border border-[#333] p-3 rounded-lg">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white">Easy Chords</p>
                      <p className="text-[8px] text-neutral-500 uppercase">Optimize key for beginners</p>
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
                        "w-10 h-5 rounded-full relative transition-all",
                        isEasyMode ? "bg-amber-500" : "bg-neutral-800"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-3 h-3 rounded-full bg-white transition-all",
                        isEasyMode ? "left-6" : "left-1"
                      )} />
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[9px] uppercase tracking-widest opacity-40 font-bold">Key Transpose</label>
                  </div>
                  <div className="flex items-center justify-between bg-neutral-900 border border-[#333] rounded p-1">
                    <button onClick={() => setKeyOffset(k => k - 1)} className="p-2 hover:bg-neutral-800 rounded transition-colors"><Minus className="w-3 h-3 text-white" /></button>
                    <span className="font-mono text-xs font-bold text-amber-500">{keyOffset >= 0 ? `+${keyOffset}` : keyOffset}</span>
                    <button onClick={() => setKeyOffset(k => k + 1)} className="p-2 hover:bg-neutral-800 rounded transition-colors"><Plus className="w-3 h-3 text-white" /></button>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[9px] uppercase tracking-widest opacity-40 font-bold">Tempo (BPM)</label>
                  <div className="flex items-center justify-between bg-neutral-900 border border-[#333] rounded p-1">
                    <button onClick={() => setCurrentTempo(t => Math.max(40, t - 1))} className="p-2 hover:bg-neutral-800 rounded transition-colors"><Minus className="w-3 h-3 text-white" /></button>
                    <span className="font-mono text-xs font-bold text-amber-500">{currentTempo}</span>
                    <button onClick={() => setCurrentTempo(t => Math.min(250, t + 1))} className="p-2 hover:bg-neutral-800 rounded transition-colors"><Plus className="w-3 h-3 text-white" /></button>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[9px] uppercase tracking-widest opacity-40 font-bold flex justify-between">
                    Scroll Speed <span>{scrollSpeed}</span>
                  </label>
                  <input 
                    type="range" min="0" max="100" step="1"
                    value={scrollSpeed}
                    onChange={(e) => setScrollSpeed(Number(e.target.value))}
                    className="w-full accent-amber-500 h-1 rounded-lg cursor-pointer bg-neutral-800 appearance-none"
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-[9px] uppercase tracking-widest opacity-40 font-bold">Scale</label>
                  <div className="flex items-center justify-between bg-neutral-900 border border-[#333] rounded p-1">
                    <button onClick={() => setFontSize(f => Math.max(6, f - 1))} className="p-2 hover:bg-neutral-800 rounded transition-colors"><Minus className="w-3 h-3 text-white" /></button>
                    <span className="font-mono text-xs">{fontSize}px</span>
                    <button onClick={() => setFontSize(f => Math.min(20, f + 1))} className="p-2 hover:bg-neutral-800 rounded transition-colors"><Plus className="w-3 h-3 text-white" /></button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Playback Control */}
      {song && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-1.5 pointer-events-none mb-0.5">
          <div className="max-w-[240px] mx-auto flex items-center justify-between bg-neutral-950 border border-white/10 px-2.5 py-1.5 rounded-full shadow-2xl pointer-events-auto">
            <button 
              onClick={() => setIsScrolling(!isScrolling)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest transition-all",
                isScrolling ? "bg-red-500/10 text-red-500 border border-red-500/10" : "bg-amber-500 text-black"
              )}
            >
              {isScrolling ? <><Pause className="w-2 h-2" /> Stop</> : <><Play className="w-2 h-2" /> Scroll</>}
            </button>

            <div className="flex items-center gap-3">
              <button 
                id="floating-print-button"
                onClick={() => handlePrint()}
                className="p-3 bg-amber-500 hover:bg-amber-400 border border-amber-600 rounded-full text-black transition-all active:scale-90 print:hidden shadow-xl shadow-amber-500/40 cursor-pointer z-[100] flex items-center justify-center"
                title="Print A4 Song Sheet"
              >
                <Printer className="w-5 h-5" />
              </button>
              <div className="h-6 w-px bg-white/10" />
              <button 
                onClick={resetScroll}
                className="p-2.5 hover:bg-neutral-900 border border-white/10 rounded-full text-white/70 min-w-[36px] min-h-[36px] flex items-center justify-center"
                title="Top"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <div className="h-6 w-px bg-white/10" />
              <div className="flex flex-col items-end px-1">
                <span className="text-[6px] uppercase tracking-tighter opacity-40 leading-none">BPM</span>
                <span className="text-[10px] font-bold text-white font-mono leading-none">{currentTempo}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Paywall Modal */}
      <AnimatePresence>
        {showPaywall && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-sm"
              onClick={() => setShowPaywall(false)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl"
            >
              <button 
                onClick={() => setShowPaywall(false)}
                className="absolute top-4 right-4 p-2 text-neutral-500 hover:text-white transition-colors z-10"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="p-8">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 mb-4">
                    <Zap className="w-8 h-8 text-red-500" />
                  </div>
                  <h2 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-2">
                    {paywallReason === 'favorites' ? 'Library limit reached' : 'Print limit reached'}
                  </h2>
                  <p className="text-neutral-400 text-sm max-w-md mx-auto">
                    You've reached the free trial limit of 5 {paywallReason === 'favorites' ? 'favorite songs' : 'prints'}. 
                    Upgrade to Chordstream Premium for unlimited access.
                  </p>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  {/* Monthly */}
                  <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-xl flex flex-col items-center hover:bg-neutral-900 transition-colors">
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-2">Monthly</span>
                    <div className="flex items-baseline gap-1 mb-6">
                      <span className="text-3xl font-black text-white">€10</span>
                      <span className="text-xs text-neutral-600">/mo</span>
                    </div>
                    <button 
                      onClick={() => handleCreateCheckoutSession(import.meta.env.VITE_STRIPE_MONTHLY_PRICE_ID)}
                      disabled={isProcessingPayment}
                      className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-black uppercase tracking-widest rounded-lg transition-colors mb-4 cursor-pointer"
                    >
                      {isProcessingPayment ? 'Processing...' : 'Subscribe'}
                    </button>
                    <ul className="space-y-2 w-full">
                      <li className="flex items-center gap-2 text-[10px] text-neutral-400">
                        <CheckCircle className="w-3 h-3 text-green-500" /> Unlimited Chords
                      </li>
                    </ul>
                  </div>

                  {/* Yearly - Best Value */}
                  <div className="bg-neutral-900 border-2 border-red-500/50 p-6 rounded-xl flex flex-col items-center relative hover:border-red-500 transition-colors">
                    <div className="absolute -top-3 bg-red-500 text-white text-[9px] font-black uppercase px-3 py-1 rounded-full tracking-widest leading-none">Best Value</div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-2 mt-2">Annual</span>
                    <div className="flex items-baseline gap-1 mb-6">
                      <span className="text-3xl font-black text-white">€60</span>
                      <span className="text-xs text-neutral-600">/yr</span>
                    </div>
                    <button 
                      onClick={() => handleCreateCheckoutSession(import.meta.env.VITE_STRIPE_YEARLY_PRICE_ID)}
                      disabled={isProcessingPayment}
                      className="w-full py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-widest rounded-lg transition-colors mb-4 shadow-lg shadow-red-500/20 cursor-pointer"
                    >
                      {isProcessingPayment ? 'Processing...' : 'Go Premium'}
                    </button>
                    <ul className="space-y-2 w-full">
                      <li className="flex items-center gap-2 text-[10px] text-neutral-400">
                        <CheckCircle className="w-3 h-3 text-green-500" /> Save €60 Yearly
                      </li>
                      <li className="flex items-center gap-2 text-[10px] text-neutral-400">
                        <CheckCircle className="w-3 h-3 text-green-500" /> Unlimited Prints
                      </li>
                    </ul>
                  </div>

                  {/* Lifetime */}
                  <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-xl flex flex-col items-center hover:bg-neutral-900 transition-colors">
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-2">Lifetime</span>
                    <div className="flex items-baseline gap-1 mb-6">
                      <span className="text-3xl font-black text-white">€120</span>
                    </div>
                    <button 
                      onClick={() => handleCreateCheckoutSession(import.meta.env.VITE_STRIPE_LIFETIME_PRICE_ID)}
                      disabled={isProcessingPayment}
                      className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-black uppercase tracking-widest rounded-lg transition-colors mb-4 cursor-pointer"
                    >
                      {isProcessingPayment ? 'Processing...' : 'Buy Once'}
                    </button>
                    <ul className="space-y-2 w-full">
                      <li className="flex items-center gap-2 text-[10px] text-neutral-400">
                        <CheckCircle className="w-3 h-3 text-green-500" /> Forever Access
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="mt-8 text-center border-t border-neutral-900 pt-6">
                  <p className="text-[9px] text-neutral-600 uppercase tracking-widest">Secure payments by Stripe. Cancel anytime.</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

const LineRenderer: React.FC<{ line: string; fontSize: number; isIntro?: boolean; onChordClick: (chord: string) => void }> = ({ line, fontSize, isIntro, onChordClick }) => {
  const segments = parseChordSegments(line);
  
  if (segments.length === 0 || (segments.length === 1 && !segments[0].chord && !segments[0].text.trim())) {
    return <div className="text-neutral-500 py-0 leading-tight opacity-40 italic mt-0.5" style={{ fontSize: `${fontSize * 0.8}px` }}>{" "}</div>;
  }

  // Detect if this is an instrumental line (lots of chords, little/no text)
  const totalTextLength = segments.reduce((acc, s) => acc + s.text.length, 0);
  const chordCount = segments.filter(s => s.chord).length;
  const isInstrumental = (chordCount > 0 && totalTextLength < 10) || isIntro;

  return (
    <div className={cn(
      "flex flex-wrap items-end font-mono group song-line-print w-full overflow-visible",
      "break-all sm:break-normal",
      isInstrumental && "gap-x-8 py-2 md:py-3 border-y border-neutral-900/50 my-1 md:my-2 bg-neutral-900/10 px-3 rounded print-instrumental"
    )}>
      {segments.map((seg, i) => (
        <div 
          key={i} 
          className={cn(
            "relative pt-4 inline-block max-w-full chord-segment-print",
            isInstrumental && "print:pt-0" // Instrumental lines in print use top-level padding
          )}
          style={{ wordWrap: 'break-word', overflowWrap: 'anywhere' }}
        >
          {seg.chord && (
            <span 
              onClick={() => onChordClick(seg.chord!)}
              className={cn(
                "absolute top-0 text-amber-500 font-black whitespace-nowrap leading-none transition-transform hover:scale-110 active:scale-95 cursor-pointer origin-left hover:text-white z-10 chord-print",
                isInstrumental ? "text-base" : ""
              )}
              style={{ 
                fontSize: `${fontSize * (isInstrumental ? 1.1 : 0.8)}px`,
                left: 0
              }}
            >
              {seg.chord}
            </span>
          )}
          <span 
            className="text-[#E0E0E0] whitespace-pre-wrap transition-all leading-none py-0.5 inline-block min-h-[1em] lyrics-print"
            style={{ 
              fontSize: `${fontSize}px`,
              // Add padding if chord is wider than text
              paddingRight: seg.chord && (!seg.text || seg.text.length < seg.chord.length) ? `${seg.chord.length - (seg.text?.length || 0)}ch` : undefined
            }}
          >
            {seg.text || (seg.chord && !isInstrumental ? " " : "")}
          </span>
        </div>
      ))}
    </div>
  );
};


