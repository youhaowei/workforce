/**
 * useEventBusInit — One-time EventBus → Zustand wiring.
 *
 * Call this once at the App root. It subscribes to all relevant
 * EventBus events and routes them to the appropriate Zustand stores.
 *
 * Note: Message streaming (TokenDelta, startAssistantMessage, finishStreamingMessage)
 * is handled directly by Shell.tsx via tRPC subscriptions, not through EventBus.
 */

import { useEffect } from 'react';
import { getEventBus } from '@/shared/event-bus';
import type {
  SystemInitEvent,
  QueryResultEvent,
  MessageStartEvent,
  AssistantMessageEvent,
  ToolProgressEvent,
  ThinkingDeltaEvent,
  HookStartedEvent,
  HookResponseEvent,
  ToolStartEvent,
  ToolEndEvent,
} from '@/shared/event-bus';
import { useSdkStore } from '../stores/useSdkStore';
import { useToolStore } from '../stores/useToolStore';

export function useEventBusInit() {
  useEffect(() => {
    const bus = getEventBus();

    // Grab stable action references from Zustand (these don't change)
    const sdk = useSdkStore.getState();
    const tool = useToolStore.getState();

    const unsubscribers = [
      // SDK store events
      bus.on('SystemInit', (e) => sdk.handleSystemInit(e as SystemInitEvent)),
      bus.on('MessageStart', (e) => {
        const evt = e as MessageStartEvent;
        sdk.handleMessageStart(evt.usage);
        // Note: messages.startAssistantMessage() is called by Shell.tsx via tRPC subscription
      }),
      bus.on('AssistantMessage', (e) => {
        const evt = e as AssistantMessageEvent;
        sdk.handleAssistantMessage(evt.usage);
        // Note: messages.finishStreamingMessage() is called by Shell.tsx via tRPC subscription
      }),
      bus.on('QueryResult', (e) => sdk.handleQueryResult(e as QueryResultEvent)),
      bus.on('ToolProgress', (e) => sdk.handleToolProgress(e as ToolProgressEvent)),
      bus.on('ThinkingDelta', (e) => sdk.handleThinkingDelta((e as ThinkingDeltaEvent).thinking)),
      bus.on('HookStarted', (e) => sdk.handleHookStarted(e as HookStartedEvent)),
      bus.on('HookResponse', (e) => sdk.handleHookResponse(e as HookResponseEvent)),

      // Tool store events
      bus.on('ToolStart', (e) => tool.handleToolStart(e as ToolStartEvent)),
      bus.on('ToolEnd', (e) => tool.handleToolEnd(e as ToolEndEvent)),

      // Note: TokenDelta → messages.appendToStreamingMessage() is handled
      // by Shell.tsx via tRPC subscription, not EventBus.
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, []);
}
