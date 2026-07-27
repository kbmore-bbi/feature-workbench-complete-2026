/**
 * Signal Service for real-time FIR signal delivery via WebSocket.
 *
 * Connects to the workbench agent WebSocket and receives signals
 * for real-time recommendations, feedback, and notifications.
 */

import { API_ROUTES } from '@/api/routes';

export type SignalPriority = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type SignalLayer = 'inline' | 'notification' | 'toast' | 'panel';

export interface SignalOption {
  id: string;
  label: string;
  action?: string;
  value?: string;
}

export interface Signal {
  signal_id: string;
  signal_type: string;
  title: string;
  message: string;
  priority: SignalPriority;
  layer: SignalLayer;
  options?: SignalOption[];
  metadata?: Record<string, unknown>;
  created_at: number;
  inference_id?: string;
  template_id?: string;
}

export interface SignalFrame {
  contract_version: string;
  type: string;
  session_id: string;
  request_id: string;
  event_id: string;
  timestamp: string;
  context_hash: string;
  data: Signal | null;
  error: Record<string, unknown> | null;
}

type SignalCallback = (signal: Signal) => void;
type ConnectionCallback = (connected: boolean, sessionId?: string) => void;
type ErrorCallback = (error: Error) => void;

class SignalService {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private signalCallbacks: Set<SignalCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private errorCallbacks: Set<ErrorCallback> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionPromise: Promise<string> | null = null;

  /**
   * Connect to the signal WebSocket.
   * Uses a connection promise to prevent duplicate connections.
   */
  async connect(): Promise<string> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.sessionId || '';
    }

    // Return existing connection promise if one is in flight
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._doConnect();
    try {
      return await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  /**
   * Internal connection implementation.
   */
  private async _doConnect(): Promise<string> {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${scheme}://${window.location.host}/api${API_ROUTES.workbench.agentGatewayWs}`;

    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(wsUrl);

        const timeout = setTimeout(() => {
          this.socket?.close();
          reject(new Error('WebSocket connection timeout'));
        }, 30000);

        this.socket.onopen = () => {
          clearTimeout(timeout);
          this.reconnectAttempts = 0;
        };

        this.socket.onmessage = (event) => {
          try {
            const frame: SignalFrame = JSON.parse(event.data);

            if (frame.type === 'session.ready') {
              this.sessionId = frame.session_id;
              this.notifyConnection(true, this.sessionId);
              resolve(this.sessionId);
            } else if (frame.type === 'assistant.signal' && frame.data) {
              this.notifySignal(frame.data);
            }
          } catch (err) {
            console.warn('Failed to parse signal frame:', err);
          }
        };

        this.socket.onerror = (event) => {
          console.error('Signal WebSocket error:', event);
          this.notifyError(new Error('WebSocket connection error'));
        };

        this.socket.onclose = () => {
          this.notifyConnection(false);
          this.scheduleReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Disconnect from the signal WebSocket.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
    this.socket?.close();
    this.socket = null;
    this.sessionId = null;
    this.connectionPromise = null;
  }

  /**
   * Subscribe to signals.
   */
  onSignal(callback: SignalCallback): () => void {
    this.signalCallbacks.add(callback);
    return () => this.signalCallbacks.delete(callback);
  }

  /**
   * Subscribe to connection state changes.
   */
  onConnection(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.add(callback);
    return () => this.connectionCallbacks.delete(callback);
  }

  /**
   * Subscribe to errors.
   */
  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Send a signal response back to the server (user selected an option).
   * This records the response as explicit feedback in the FIR pipeline.
   */
  sendSignalResponse(signalId: string, optionId: string, recommendationId?: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send signal response: not connected');
      return;
    }

    this.socket.send(JSON.stringify({
      type: 'signal_response',
      request_id: signalId,
      data: {
        signal_id: signalId,
        option_id: optionId,
        recommendation_id: recommendationId || signalId,
      },
    }));
  }

  private notifySignal(signal: Signal): void {
    this.signalCallbacks.forEach((cb) => {
      try {
        cb(signal);
      } catch (err) {
        console.error('Signal callback error:', err);
      }
    });
  }

  private notifyConnection(connected: boolean, sessionId?: string): void {
    this.connectionCallbacks.forEach((cb) => {
      try {
        cb(connected, sessionId);
      } catch (err) {
        console.error('Connection callback error:', err);
      }
    });
  }

  private notifyError(error: Error): void {
    this.errorCallbacks.forEach((cb) => {
      try {
        cb(error);
      } catch (err) {
        console.error('Error callback error:', err);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('Max reconnection attempts reached for signal service');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      console.log(`Attempting to reconnect signal service (attempt ${this.reconnectAttempts})`);
      this.connect().catch((err) => {
        console.warn('Reconnection failed:', err);
      });
    }, delay);
  }
}

// Singleton instance
export const signalService = new SignalService();
