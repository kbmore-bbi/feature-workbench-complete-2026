/**
 * React hook for subscribing to real-time FIR signals.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { signalService, Signal, SignalPriority, SignalLayer } from '@/services/signalService';

const MAX_SIGNAL_AGE_MS = 60 * 1000; // 1 minute - signals older than this are considered stale

export interface UseSignalsOptions {
  autoConnect?: boolean;
  filterPriority?: SignalPriority[];
  filterLayer?: SignalLayer[];
  filterType?: string[];
  maxSignals?: number;
}

export interface UseSignalsResult {
  signals: Signal[];
  isConnected: boolean;
  sessionId: string | null;
  error: Error | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  dismissSignal: (signalId: string) => void;
  clearSignals: () => void;
}

export function useSignals(options: UseSignalsOptions = {}): UseSignalsResult {
  const {
    autoConnect = true,
    filterPriority,
    filterLayer,
    filterType,
    maxSignals = 10,
  } = options;

  const [signals, setSignals] = useState<Signal[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const shouldIncludeSignal = useCallback(
    (signal: Signal): boolean => {
      if (filterPriority && !filterPriority.includes(signal.priority)) {
        return false;
      }
      if (filterLayer && !filterLayer.includes(signal.layer)) {
        return false;
      }
      if (filterType && !filterType.includes(signal.signal_type)) {
        return false;
      }
      return true;
    },
    [filterPriority, filterLayer, filterType]
  );

  // Use refs for callbacks to avoid recreating the effect on every render
  const shouldIncludeSignalRef = useRef(shouldIncludeSignal);
  const maxSignalsRef = useRef(maxSignals);
  useEffect(() => {
    shouldIncludeSignalRef.current = shouldIncludeSignal;
    maxSignalsRef.current = maxSignals;
  }, [maxSignals, shouldIncludeSignal]);

  // Track if we've already initiated a connection
  const hasInitiatedConnection = useRef(false);

  const handleSignal = useCallback((signal: Signal) => {
    // Filter out stale signals
    const signalAge = Date.now() - signal.created_at;
    if (signalAge > MAX_SIGNAL_AGE_MS) {
      console.debug('Ignoring stale signal:', signal.signal_id, 'age:', signalAge);
      return;
    }

    if (!shouldIncludeSignalRef.current(signal)) {
      return;
    }

    setSignals((prev) => {
      const existing = prev.find((s) => s.signal_id === signal.signal_id);
      if (existing) {
        return prev;
      }

      const updated = [signal, ...prev];
      return updated.slice(0, maxSignalsRef.current);
    });
  }, []);

  const handleConnection = useCallback((connected: boolean, sid?: string) => {
    setIsConnected(connected);
    setSessionId(sid || null);
    if (!connected) {
      setError(null);
    }
  }, []);

  const handleError = useCallback((err: Error) => {
    setError(err);
  }, []);

  const connect = useCallback(async () => {
    try {
      setError(null);
      await signalService.connect();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  const disconnect = useCallback(() => {
    signalService.disconnect();
  }, []);

  const dismissSignal = useCallback((signalId: string) => {
    setSignals((prev) => prev.filter((s) => s.signal_id !== signalId));
  }, []);

  const clearSignals = useCallback(() => {
    setSignals([]);
  }, []);

  // Connection effect - runs only once when autoConnect is true
  useEffect(() => {
    const unsubSignal = signalService.onSignal(handleSignal);
    const unsubConnection = signalService.onConnection(handleConnection);
    const unsubError = signalService.onError(handleError);

    // Only connect once per hook instance
    if (autoConnect && !hasInitiatedConnection.current) {
      hasInitiatedConnection.current = true;
      connect();
    }

    return () => {
      unsubSignal();
      unsubConnection();
      unsubError();
    };
  }, [autoConnect, connect, handleSignal, handleConnection, handleError]);

  return {
    signals,
    isConnected,
    sessionId,
    error,
    connect,
    disconnect,
    dismissSignal,
    clearSignals,
  };
}

export type { Signal, SignalPriority, SignalLayer };
