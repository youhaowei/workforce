/**
 * Shell - Main application layout
 *
 * The primary container that orchestrates:
 * - Header with app info and profile status
 * - Message list with virtual scrolling
 * - Input area for user messages
 * - Status bar with current state
 */

import { createSignal, Show, onMount, onCleanup } from 'solid-js';
import { MessageList, MessageInput } from '../Messages';
import { TodoPanel } from '../Todo';
import { SessionsPanel } from '../Sessions';
import {
  getMessages,
  getIsStreaming,
  addUserMessage,
  startAssistantMessage,
  appendToStreamingMessage,
  finishStreamingMessage,
} from '@ui/stores/messagesStore';
import { initToolStore } from '@ui/stores/toolStore';
import { initBridge, streamQuery } from '@bridge/index';
import { getEventBus } from '@shared/event-bus';

const SERVER_URL = 'http://localhost:4096';

async function checkServerConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

const styles = {
  container: 'h-screen flex flex-col bg-white',
  header: 'flex-shrink-0 px-6 py-4 border-b border-gray-200 bg-white',
  headerContent: 'max-w-3xl mx-auto flex items-center justify-between',
  title: 'text-xl font-semibold text-gray-900',
  subtitle: 'text-sm text-gray-500',
  profileBadge: 'px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700',
  main: 'flex-1 flex flex-col overflow-hidden',
  statusBar: 'flex-shrink-0 px-6 py-2 border-t border-gray-200 bg-gray-50',
  statusContent: 'max-w-3xl mx-auto flex items-center justify-between text-xs text-gray-500',
  statusItem: 'flex items-center gap-2',
  statusDot: 'w-2 h-2 rounded-full',
  statusDotIdle: 'bg-gray-400',
  statusDotActive: 'bg-green-500 animate-pulse',
  errorBanner: 'px-6 py-3 bg-red-50 border-b border-red-200',
  errorContent: 'max-w-3xl mx-auto flex items-center justify-between',
  errorText: 'text-sm text-red-700',
  errorDismiss: 'text-red-500 hover:text-red-700 text-sm',
  serverBanner: 'px-6 py-3 bg-amber-50 border-b border-amber-200',
  serverBannerContent: 'max-w-3xl mx-auto',
  serverBannerTitle: 'text-sm font-medium text-amber-800',
  serverBannerText: 'text-sm text-amber-700 mt-1',
  serverBannerCode: 'font-mono bg-amber-100 px-2 py-0.5 rounded text-amber-900',
};

export default function Shell() {
  const [currentProfile, _setCurrentProfile] = createSignal('coder');
  const [error, setError] = createSignal<string | null>(null);
  const [messageCount, setMessageCount] = createSignal(0);
  const [todoPanelOpen, setTodoPanelOpen] = createSignal(false);
  const [sessionsPanelOpen, setSessionsPanelOpen] = createSignal(false);
  const [serverConnected, setServerConnected] = createSignal(false);
  let cancelStream: (() => void) | null = null;

  // Check server connection on mount and periodically
  onMount(() => {
    initToolStore();

    const checkConnection = async () => {
      const connected = await checkServerConnection();
      setServerConnected(connected);
      if (connected) {
        initBridge().catch(console.error);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 5000);
    onCleanup(() => clearInterval(interval));
  });

  onMount(() => {
    const bus = getEventBus();

    const unsubError = bus.on('BridgeError', (event) => {
      setError(event.error);
      setTimeout(() => setError(null), 5000);
    });

    onCleanup(() => {
      unsubError();
    });
  });

  // Update message count reactively
  const messages = () => {
    const msgs = getMessages();
    setMessageCount(msgs.length);
    return msgs;
  };

  // getIsStreaming returns an Accessor<boolean>
  const streamingSignal = getIsStreaming();

  const handleSubmit = (content: string) => {
    addUserMessage(content);
    startAssistantMessage();

    cancelStream = streamQuery(
      content,
      (token) => appendToStreamingMessage(token),
      () => {
        finishStreamingMessage();
        cancelStream = null;
      },
      (err) => {
        finishStreamingMessage();
        setError(err);
        cancelStream = null;
      }
    );
  };

  const handleCancel = () => {
    if (cancelStream) {
      cancelStream();
      cancelStream = null;
    }
    finishStreamingMessage();
  };

  const dismissError = () => {
    setError(null);
  };

  return (
    <div class={styles.container}>
      {/* Header */}
      <header class={styles.header}>
        <div class={styles.headerContent}>
          <div>
            <h1 class={styles.title}>Fuxi</h1>
            <p class={styles.subtitle}>Agentic Orchestrator</p>
          </div>
          <div class="flex items-center gap-3">
            <button
              class={`px-3 py-1 text-sm rounded ${
                sessionsPanelOpen()
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              onClick={() => setSessionsPanelOpen((prev) => !prev)}
              title="Toggle Sessions Panel (Cmd+H)"
            >
              History
            </button>
            <button
              class={`px-3 py-1 text-sm rounded ${
                todoPanelOpen()
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              onClick={() => setTodoPanelOpen((prev) => !prev)}
              title="Toggle Todo Panel (Cmd+T)"
            >
              Todos
            </button>
            <span class={styles.profileBadge}>{currentProfile()}</span>
          </div>
        </div>
      </header>

      {/* Server Not Connected Banner */}
      <Show when={!serverConnected()}>
        <div class={styles.serverBanner}>
          <div class={styles.serverBannerContent}>
            <div class={styles.serverBannerTitle}>Server not connected</div>
            <div class={styles.serverBannerText}>
              Run <code class={styles.serverBannerCode}>bun run server</code> in your terminal first, then refresh this page.
            </div>
          </div>
        </div>
      </Show>

      {/* Error Banner */}
      <Show when={error()}>
        <div class={styles.errorBanner}>
          <div class={styles.errorContent}>
            <span class={styles.errorText}>{error()}</span>
            <button onClick={dismissError} class={styles.errorDismiss}>
              Dismiss
            </button>
          </div>
        </div>
      </Show>

      {/* Main Content */}
      <main class="flex-1 flex overflow-hidden">
        {/* Sessions Panel (Left) */}
        <SessionsPanel
          isOpen={sessionsPanelOpen()}
          onClose={() => setSessionsPanelOpen(false)}
        />

        {/* Main Chat Area */}
        <div class="flex-1 flex flex-col overflow-hidden">
          <MessageList messages={messages()} isStreaming={streamingSignal()} />
          <MessageInput onSubmit={handleSubmit} onCancel={handleCancel} isStreaming={streamingSignal()} />
        </div>

        {/* Todo Panel (Right) */}
        <TodoPanel
          isOpen={todoPanelOpen()}
          onClose={() => setTodoPanelOpen(false)}
        />
      </main>

      {/* Status Bar */}
      <footer class={styles.statusBar}>
        <div class={styles.statusContent}>
          <div class={styles.statusItem}>
            <span
              class={`${styles.statusDot} ${streamingSignal() ? styles.statusDotActive : styles.statusDotIdle}`}
            />
            <span>{streamingSignal() ? 'Streaming...' : 'Ready'}</span>
          </div>
          <div class={styles.statusItem}>
            <span>{messageCount()} messages</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
