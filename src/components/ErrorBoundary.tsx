import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RotateCcw, Trash2 } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      // Try to unregister any service worker
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const registration of registrations) {
            registration.unregister();
          }
        });
      }
      
      // Clear all caches
      if ("caches" in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => caches.delete(key));
        });
      }
    } catch (e) {
      console.error("Cleanup failed:", e);
    }

    // Hard reload
    window.location.replace(window.location.origin + window.location.pathname);
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0F0F11] text-[#E0E0E0] flex flex-col items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-center w-12 h-12 bg-red-500/10 rounded-xl mb-4 mx-auto">
              <AlertCircle className="w-6 h-6 text-red-500" />
            </div>
            
            <h2 className="text-xl font-black text-white text-center uppercase tracking-tighter mb-2">
              Application Encountered an Error
            </h2>
            
            <p className="text-neutral-400 text-xs text-center mb-6 uppercase tracking-wider leading-relaxed">
              Something went wrong during rendering. This is usually caused by outdated browser caches or invalid locally saved preferences.
            </p>

            <div className="bg-red-500/5 rounded-xl p-4 border border-red-500/10 mb-6 font-mono text-[11px] text-red-400/90 overflow-x-auto max-h-40 custom-scrollbar">
              <div className="font-bold mb-1">Details:</div>
              <div className="whitespace-pre-wrap">{this.state.error?.stack || this.state.error?.toString()}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={this.handleReset}
                className="py-3 px-4 bg-amber-500 hover:bg-amber-400 text-black font-black uppercase tracking-widest text-[9px] rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reset & Reload
              </button>
              
              <button
                onClick={() => window.location.reload()}
                className="py-3 px-4 bg-neutral-800 hover:bg-neutral-700 text-white font-black uppercase tracking-widest text-[9px] rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Quick Retry
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
