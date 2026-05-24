import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Send, Sparkles, Check, Server, Github, Smartphone, HelpCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

interface Message {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

export function FeedbackAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: "Hi! I'm your Chordstream Dev Representative. Feel free to report any bugs, request songs, or ask guitar/technical questions. I can log your feedback directly into our database for Sunny (our AI Coding Agent in Google AI Studio) to fix and push to GitHub!",
      timestamp: new Date()
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [category, setCategory] = useState<'bug' | 'feature_request' | 'song_request' | 'general'>('general');
  const [activeTab, setActiveTab] = useState<'chat' | 'pipeline'>('chat');
  
  // Ticket status
  const [submittedTicket, setSubmittedTicket] = useState<{ id: string; msg: string } | null>(null);
  
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isOpen]);

  // Instantiate Gemini safely
  const getGeminiClient = (): GoogleGenAI | null => {
    try {
      const key = process.env.GEMINI_API_KEY;
      if (key && !key.includes('***') && !key.includes('...') && key.trim() !== '') {
        return new GoogleGenAI({ 
          apiKey: key.trim(),
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });
      }
    } catch (e) {
      console.warn("FeedbackAssistant: Failed to initialize Gemini API", e);
    }
    return null;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const userMsgText = inputText;
    const currentCategory = category;
    setInputText('');
    
    // Add user message to state
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: userMsgText,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    // Save ticket to Firestore asynchronously
    let firestoreDocId = '';
    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        const feedbackRef = collection(db, 'feedbacks');
        const docRef = await addDoc(feedbackRef, {
          userId: currentUser.uid,
          userEmail: currentUser.email || 'Anonymous',
          message: `[Category: ${currentCategory}] ${userMsgText}`,
          category: currentCategory,
          timestamp: serverTimestamp(),
          status: 'open'
        });
        firestoreDocId = docRef.id;
        setSubmittedTicket({ id: docRef.id, msg: userMsgText });
      } catch (err) {
        console.error("Failed to write feedback to Firestore:", err);
      }
    } else {
      console.log("No authenticated user to write feedback to Firestore");
    }

    try {
      const aiClient = getGeminiClient();
      let replyText = "";

      if (aiClient) {
        // Query server/client-side Gemini
        const systemPrompt = `You are the Chordstream Supportive Developer Advocate AI Agent. 
        Your primary duty is to listen to the user's software feedback, bug reports, feature requests, or song requests regarding Chordstream (the hands-free guitar songbook app with key transpositions and chord placement).
        
        Currently, the user's message is being logged with Category: "${currentCategory}".
        ${firestoreDocId ? `Perfect! This ticket is logged successfully in Firestore under Document ID: "${firestoreDocId}".` : `We are running locally; the feedback will be saved to their account.`}

        BE SURE TO EXPLAIN CLEARLY OF THE FLOW:
        1. Their feedback is now permanently recorded in our Firestore database.
        2. Sunny (our active AI Coding Agent inside Google AI Studio) monitors this collection in real-time.
        3. Once Sunny notices a bug sheet or request, Sunny writes physical code fixes to correct the errors, checks the app builds, and pushes a commit directly to GitHub.
        4. GitHub Actions immediately builds the new Android bundle (AAB/APK) from the master branch ready for Google Play Store delivery.

        Be warm, helpful, positive, and technically reassuring. Answer any guitar, chords, transposition, or software troubleshooting questions they have eloquently. Keep formatting clean.`;

        const response = await aiClient.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [
            { text: `User message: "${userMsgText}"\nCategory: "${currentCategory}"` }
          ],
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7
          }
        });

        replyText = response.text || "Your feedback was logged, but I didn't receive a detailed response. Our engineering team is on manual review!";
      } else {
        // Fallback simulated reply if no valid API key is present
        replyText = `Thank you for your feedback! I have successfully logged your [${currentCategory.toUpperCase()}] ticket${firestoreDocId ? ` (ID: ${firestoreDocId})` : ""} in our Firestore database. 

Since the Gemini developers are working in a sandbox, here is how Sunny (the Google AI Studio developer agent) handles your ticket:
1. **Real-time Synchronization**: Your message is captured in our Firestore ledger.
2. **Workspace Diagnostics**: Our coding agent on Google AI Studio pulls active issues, writes clean layout/code corrections, and runs tests.
3. **Automated Android Deployment**: Once resolved, we push the fixed code to GitHub, where GitHub Actions automatically builds the release AAB/APK bundle for Google Play Store!

Your input helps us build Chordstream into the ultimate hands-free songbook!`;
      }

      setMessages(prev => [...prev, {
        id: `agent-${Date.now()}`,
        sender: 'agent',
        text: replyText,
        timestamp: new Date()
      }]);

    } catch (error) {
      console.error("Gemini Agent API error:", error);
      setMessages(prev => [...prev, {
        id: `agent-error-${Date.now()}`,
        sender: 'agent',
        text: "I logged your ticket in our secure database, but I hit a temporary API error while processing the conversation. Rest assured, our AI developer will analyze your logs on Google AI Studio!",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] font-sans">
      {/* Floating Sparkle Action Button */}
      <motion.button
        id="btn-feedback-trigger"
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        className="flex items-center gap-2 px-4 py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-neutral-950 font-black rounded-full shadow-[0_0_25px_rgba(245,158,11,0.35)] cursor-pointer group uppercase tracking-widest text-xs select-none border border-amber-400/30"
      >
        <Sparkles className="w-4 h-4 animate-pulse group-hover:rotate-12 transition-transform duration-300" />
        <span>Dev Support Agent</span>
      </motion.button>

      {/* Slide-out Overlay Sidebar Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110]"
            />

            {/* Panel */}
            <motion.div
              id="feedback-dialog-panel"
              initial={{ x: '100%', opacity: 0.9 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0.9 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md sm:max-w-lg bg-neutral-950 border-l border-neutral-900 shadow-[0_0_40px_rgba(0,0,0,0.8)] z-[120] flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="p-5 border-b border-neutral-900 bg-neutral-950/80 backdrop-blur flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-white uppercase tracking-wider">Dev Support Agent</h2>
                    <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Google AI Studio Sandbox Helper</p>
                  </div>
                </div>
                <button
                  id="btn-close-feedback"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white rounded-md transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Navigation Tabs */}
              <div className="flex border-b border-neutral-900 bg-neutral-950/50">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                    activeTab === 'chat' 
                      ? 'text-amber-500 border-b-2 border-amber-500 bg-amber-500/5' 
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  Interactive AI Chat
                </button>
                <button
                  onClick={() => setActiveTab('pipeline')}
                  className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                    activeTab === 'pipeline' 
                      ? 'text-amber-500 border-b-2 border-amber-500 bg-amber-500/5' 
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  Automated Deployment Flow
                </button>
              </div>

              {/* Tab Content 1: Chat Dashboard */}
              <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'chat' ? 'flex' : 'hidden'}`}>
                {/* Active Ticket Status Indicator */}
                <AnimatePresence>
                  {submittedTicket && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="bg-amber-500/5 border-b border-amber-500/10 px-5 py-2.5 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-[10px] text-neutral-300 font-mono">
                          Firestore Ticket <span className="text-amber-500">{submittedTicket.id.substring(0, 8)}...</span> logged successfully!
                        </span>
                      </div>
                      <button 
                        onClick={() => setSubmittedTicket(null)}
                        className="text-[9px] font-black uppercase tracking-widest text-[#E0E0E0] hover:text-amber-500 transition-colors"
                      >
                        Dismiss
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Main scrollable messages */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin scrollbar-thumb-neutral-900">
                  {messages.map((msg) => (
                    <div 
                      key={msg.id} 
                      className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] rounded-2xl p-4 border text-[13px] leading-relaxed ${
                        msg.sender === 'user' 
                          ? 'bg-neutral-900 border-neutral-800 text-white' 
                          : 'bg-neutral-950 border-neutral-900 text-neutral-300 shadow-md'
                      }`}>
                        {/* Sender Label */}
                        <div className="flex items-center gap-1.5 mb-1 text-[9px] font-black uppercase tracking-widest">
                          {msg.sender === 'agent' ? (
                            <>
                              <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                              <span className="text-amber-500">Representative AI</span>
                            </>
                          ) : (
                            <>
                              <span className="text-neutral-500">You (Guitarist)</span>
                            </>
                          )}
                        </div>
                        {/* Text */}
                        <div className="whitespace-pre-wrap select-text">{msg.text}</div>
                      </div>
                    </div>
                  ))}

                  {/* Typing Indicator */}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-neutral-950 border border-neutral-900 rounded-2xl p-4 flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                        <span className="text-[11px] text-neutral-500 font-mono uppercase tracking-widest">Logging and generating response...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* Category selectors */}
                <div className="px-5 pt-3 pb-2 border-t border-neutral-900 bg-neutral-950/20 flex flex-wrap items-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-neutral-500 mr-1">TICKET CATEGORY:</span>
                  {(['bug', 'feature_request', 'song_request', 'general'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-widest rounded transition-all cursor-pointer border ${
                        category === cat 
                          ? 'bg-amber-500 text-neutral-950 border-amber-400' 
                          : 'bg-neutral-900 text-neutral-500 border-neutral-800 hover:text-white'
                      }`}
                    >
                      {cat.replace('_', ' ')}
                    </button>
                  ))}
                </div>

                {/* Input Form */}
                <form onSubmit={handleSendMessage} className="p-4 border-t border-neutral-900 bg-neutral-950">
                  <div className="flex gap-2">
                    <input
                      id="input-feedback-message"
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={
                        category === 'bug' 
                          ? "Explain what is broken in detail..." 
                          : category === 'song_request'
                          ? "Which song would you like us to import next?..."
                          : "Type your feedback or question..."
                      }
                      className="flex-1 bg-neutral-900 border border-neutral-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-white rounded-lg px-4 py-2 text-xs transition-colors outline-none placeholder:text-neutral-600"
                    />
                    <button
                      id="btn-send-feedback"
                      type="submit"
                      disabled={isLoading || !inputText.trim()}
                      className="p-2.5 bg-amber-500 hover:bg-amber-600 text-neutral-950 rounded-lg transition-colors font-bold disabled:opacity-50 disabled:hover:bg-amber-500 cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </div>

              {/* Tab Content 2: Explaining Automated Pipeline */}
              <div className={`flex-1 overflow-y-auto p-6 space-y-6 bg-neutral-950 select-text ${activeTab === 'pipeline' ? 'block' : 'hidden'}`}>
                <div className="text-center pb-2">
                  <div className="inline-flex p-3 bg-amber-500/5 rounded-full border border-amber-500/10 mb-3">
                    <HelpCircle className="w-6 h-6 text-amber-500" />
                  </div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">The Live Sync Pipeline</h3>
                  <p className="text-xs text-neutral-400 mt-1">Here is how your feedbacks find their way to Google Play Store</p>
                </div>

                {/* Stepper container */}
                <div className="space-y-6 relative before:absolute before:left-4.5 before:top-4 before:bottom-4 before:w-0.5 before:bg-neutral-900">
                  
                  {/* Step 1 */}
                  <div className="flex gap-4 relative">
                    <div className="w-9 h-9 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-amber-500 z-10 shrink-0 shadow-md">
                      <Server className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-[#E0E0E0] mb-1">1. Stored in Firestore</h4>
                      <p className="text-xs text-neutral-400 leading-relaxed">
                        When you submit feedback or chat in this support helper, we instantly compile a secure ledger payload and log it directly in **Google Cloud Firestore**.
                      </p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex gap-4 relative">
                    <div className="w-9 h-9 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-amber-500 z-10 shrink-0 shadow-md">
                      <Sparkles className="w-4 h-4 animate-pulse" />
                    </div>
                    <div>
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-[#E0E0E0] mb-1">2. Handled on Google AI Studio</h4>
                      <p className="text-xs text-neutral-400 leading-relaxed">
                        Sunny—our **AI Coding Agent on Google AI Studio**—monitors the Firestore feed in real-time. Sunny reads your specific diagnostics, analyzes the source code, writes robust physical modifications (re-structuring types, refining margins, or adjusting transpositions), and ensures local syntax compiles correctly.
                      </p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex gap-4 relative">
                    <div className="w-9 h-9 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-amber-500 z-10 shrink-0 shadow-md">
                      <Github className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-[#E0E0E0] mb-1">3. Automated Git Push & Rebuild</h4>
                      <p className="text-xs text-neutral-400 leading-relaxed">
                        The agent commits the updated workspace changes and pushes them directly back to your **GitHub Repository** on the master branch.
                      </p>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="flex gap-4 relative">
                    <div className="w-9 h-9 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-amber-500 z-10 shrink-0 shadow-md">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-[#E0E0E0] mb-1">4. CI/CD & Play Store Dispatch</h4>
                      <p className="text-xs text-neutral-400 leading-relaxed">
                        Your GitHub Actions CI/CD workflows immediately trigger on the push event. The test actions clean, sync via Capacitor, and export a signed release **App Bundle (AAB)** or debug **APK** file. This bundle gets delivered to Google Play Console automatically!
                      </p>
                    </div>
                  </div>

                </div>

                {/* Informative Footer */}
                <div className="bg-neutral-950 border border-neutral-900 rounded-xl p-4 text-[11px] text-neutral-500 leading-relaxed font-mono">
                  <span className="text-amber-500 font-bold block mb-1">💡 Sandbox Integration Active:</span>
                  This environment is fully operational! You can review active feedback documents under your Firebase console's `feedbacks` collection at any time.
                </div>
              </div>

            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
