/**
 * Shell - Main application layout
 *
 * Harmony-themed design inspired by balance, serenity, and Eastern philosophy.
 * Features yin-yang motifs, warm cream backgrounds, and burgundy/gold accents.
 */

import { createSignal, Show, onMount, onCleanup } from 'solid-js';
import { MessageList, MessageInput } from '../Messages';
import { TodoPanel } from '../Todo';
import { SessionsPanel } from '../Sessions';
import { HotkeyProvider, useHotkeys } from '@ui/hotkeys';
import {
  getMessages,
  getIsStreaming,
  addUserMessage,
  startAssistantMessage,
  appendToStreamingMessage,
  finishStreamingMessage,
} from '@ui/stores/messagesStore';
import { initToolStore } from '@ui/stores/toolStore';
import { initSdkStore, cleanupSdkStore, getCumulativeUsage, getCurrentQueryStats } from '@ui/stores/sdkStore';
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

// Harmony Logo component (inline SVG for best control)
function HarmonyLogo(props: { size?: number; class?: string }) {
  const size = props.size || 48;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" class={props.class} fill="none">
      <circle cx="24" cy="24" r="22.08" stroke="#8B2635" stroke-width="0.72" />
      <path
        d="M24,1.92 C36.1944473,1.92 46.08,11.8055527 46.08,24 C46.08,36.1944473 36.1944473,46.08 24,46.08 C17.9027764,46.08 12.96,41.1372236 12.96,35.04 C12.96,28.9427764 17.9027764,24 24,24 C30.0972236,24 35.04,19.0572236 35.04,12.96 C35.04,6.86277636 30.0972236,1.92 24,1.92"
        fill="#8B2635"
      />
      <circle cx="24" cy="12.96" r="2.4" fill="#F8F5EE" />
      <circle cx="24" cy="35.04" r="2.4" fill="#8B2635" />
      <path
        d="M24,42.24 C34.0736738,42.24 42.24,34.0736738 42.24,24 C42.24,13.9263262 34.0736738,5.76 24,5.76 C13.9263262,5.76 5.76,13.9263262 5.76,24 C5.76,34.0736738 13.9263262,42.24 24,42.24 Z"
        stroke="#C9A227"
        stroke-width="0.24"
        stroke-dasharray="1.92"
      />
    </svg>
  );
}

// Inner shell component that can use hotkey hooks
function ShellContent() {
  const hotkeys = useHotkeys();
  const [currentProfile, _setCurrentProfile] = createSignal('coder');
  const [error, setError] = createSignal<string | null>(null);
  const [messageCount, setMessageCount] = createSignal(0);
  const [todoPanelOpen, setTodoPanelOpen] = createSignal(false);
  const [sessionsPanelOpen, setSessionsPanelOpen] = createSignal(false);
  const [serverConnected, setServerConnected] = createSignal(false);
  let cancelStream: (() => void) | null = null;

  onMount(() => {
    initToolStore();
    initSdkStore();

    const checkConnection = async () => {
      const connected = await checkServerConnection();
      setServerConnected(connected);
      if (connected) {
        initBridge().catch(console.error);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 5000);
    onCleanup(() => {
      clearInterval(interval);
      cleanupSdkStore();
    });
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

  // Register hotkey actions
  onMount(() => {
    hotkeys.registerPanelToggles({
      history: () => setSessionsPanelOpen((prev) => !prev),
      tasks: () => setTodoPanelOpen((prev) => !prev),
    });
    hotkeys.registerCancelStream(() => handleCancel());
  });

  const messages = () => {
    const msgs = getMessages();
    setMessageCount(msgs.length);
    return msgs;
  };

  const streamingSignal = getIsStreaming();

  const handleSubmit = (content: string) => {
    console.log('[Shell] handleSubmit called:', content.slice(0, 50));
    console.log('[Shell] Current streaming state:', streamingSignal());

    addUserMessage(content);
    const msgId = startAssistantMessage();
    console.log('[Shell] Started assistant message:', msgId);

    cancelStream = streamQuery(
      content,
      (token) => {
        console.log('[Shell] onToken callback:', token.slice(0, 50));
        appendToStreamingMessage(token);
      },
      () => {
        console.log('[Shell] onDone callback');
        finishStreamingMessage();
        cancelStream = null;
      },
      (err) => {
        console.log('[Shell] onError callback:', err);
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
    <div class="h-screen flex flex-col bg-cream-100 harmony-texture overflow-hidden">
      {/* Header */}
      <header class="flex-shrink-0 bg-cream-50/95 backdrop-blur-md border-b border-burgundy-500/10">
        <div class="max-w-5xl mx-auto px-6">
          <div class="flex items-center justify-between h-16">
            {/* Logo */}
            <div class="flex items-center gap-4 group">
              <div class="logo-container">
                <HarmonyLogo size={40} />
              </div>
              <div>
                <h1 class="font-serif text-xl font-semibold text-burgundy-500 tracking-wide">
                  Fuxi
                </h1>
                <p class="text-xs text-charcoal-600 tracking-[0.15em] uppercase">
                  Agentic Orchestrator
                </p>
              </div>
            </div>

            {/* Navigation */}
            <nav class="flex items-center gap-2">
              <button
                class={`px-4 py-2 font-serif text-sm tracking-wide rounded-lg transition-all duration-300 accent-line-gold ${
                  sessionsPanelOpen()
                    ? 'text-burgundy-500 bg-burgundy-500/5 active'
                    : 'text-charcoal-600 hover:text-burgundy-500'
                }`}
                onClick={() => setSessionsPanelOpen((prev) => !prev)}
                title="Toggle Sessions Panel"
              >
                History
              </button>
              <button
                class={`px-4 py-2 font-serif text-sm tracking-wide rounded-lg transition-all duration-300 accent-line-gold ${
                  todoPanelOpen()
                    ? 'text-burgundy-500 bg-burgundy-500/5 active'
                    : 'text-charcoal-600 hover:text-burgundy-500'
                }`}
                onClick={() => setTodoPanelOpen((prev) => !prev)}
                title="Toggle Todo Panel"
              >
                Tasks
              </button>

              {/* Profile badge */}
              <div class="ml-3 px-4 py-1.5 bg-burgundy-500 text-white font-serif text-xs tracking-wide rounded-full">
                {currentProfile()}
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* Server Not Connected Banner */}
      <Show when={!serverConnected()}>
        <div class="px-6 py-4 bg-gold-500/10 border-b border-gold-500/20">
          <div class="max-w-5xl mx-auto flex items-center gap-4">
            <div class="w-10 h-10 rounded-full bg-gold-500/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9A227" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <p class="font-serif text-charcoal-800">Server not connected</p>
              <p class="text-sm text-charcoal-600">
                Run <code class="font-mono bg-cream-200 px-2 py-0.5 rounded text-burgundy-500">bun run server</code> to start
              </p>
            </div>
          </div>
        </div>
      </Show>

      {/* Error Banner */}
      <Show when={error()}>
        <div class="px-6 py-3 bg-burgundy-500/10 border-b border-burgundy-500/20">
          <div class="max-w-5xl mx-auto flex items-center justify-between">
            <span class="text-sm text-burgundy-500">{error()}</span>
            <button
              onClick={dismissError}
              class="text-burgundy-500/60 hover:text-burgundy-500 text-sm font-serif transition-colors"
            >
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
      <footer class="flex-shrink-0 px-6 py-2 border-t border-burgundy-500/10 bg-cream-50/80">
        <div class="max-w-5xl mx-auto flex items-center justify-between text-xs">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <span
                class={`w-2 h-2 rounded-full transition-all duration-300 ${
                  streamingSignal() ? 'status-active' : 'status-idle'
                }`}
              />
              <span class={`font-sans ${streamingSignal() ? 'text-sage-500' : 'text-charcoal-600'}`}>
                {streamingSignal() ? 'Thinking...' : 'Ready'}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-4 text-charcoal-600">
            {/* Token usage display */}
            <Show when={getCumulativeUsage().inputTokens > 0 || getCumulativeUsage().outputTokens > 0}>
              <span class="text-charcoal-500" title="Input / Output tokens">
                {getCumulativeUsage().inputTokens.toLocaleString()} / {getCumulativeUsage().outputTokens.toLocaleString()} tokens
              </span>
            </Show>
            {/* Cost display */}
            <Show when={getCumulativeUsage().totalCostUsd > 0}>
              <span class="text-gold-600" title="Estimated cost">
                ${getCumulativeUsage().totalCostUsd.toFixed(4)}
              </span>
            </Show>
            {/* Query stats */}
            <Show when={getCurrentQueryStats()}>
              <span class="text-charcoal-500" title="Last query duration">
                {(getCurrentQueryStats()!.durationMs / 1000).toFixed(1)}s
              </span>
            </Show>
            <span>{messageCount()} messages</span>
            <div class="w-4 h-4 opacity-40">
              <HarmonyLogo size={16} />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Main Shell component with HotkeyProvider wrapper
export default function Shell() {
  return (
    <HotkeyProvider>
      <ShellContent />
    </HotkeyProvider>
  );
}
