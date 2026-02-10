import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { streamQuery, trpcClient } from '@bridge/index';
import { useAppStore } from '@ui/stores/appStore';
import { useServerConnection } from '@ui/hooks/useServerConnection';
import type { TodoItem } from '@ui/types/domain';
import AppSidebar from '@ui/components/layout/AppSidebar';
import AppTopBar from '@ui/components/layout/AppTopBar';
import StatusBar from '@ui/components/layout/StatusBar';
import ChatView from '@ui/components/chat/ChatView';
import SessionsPanel from '@ui/components/panels/SessionsPanel';
import TodosPanel from '@ui/components/panels/TodosPanel';
import TemplateManagerView from '@ui/components/views/TemplateManagerView';
import WorkflowManagerView from '@ui/components/views/WorkflowManagerView';
import BoardView from '@ui/components/views/BoardView';
import ReviewQueueView from '@ui/components/views/ReviewQueueView';
import HistoryView from '@ui/components/views/HistoryView';
import { Alert, AlertDescription } from '@ui/components/ui';

const queryClient = new QueryClient();

function AppShell(): React.ReactElement {
  const queryClientInstance = useQueryClient();
  const streamStateRef = useRef<{ assistant: string; canceled: boolean } | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamCancel, setStreamCancel] = useState<(() => void) | null>(null);
  const [streamingAssistantContent, setStreamingAssistantContent] = useState('');

  const {
    tab,
    sessionsOpen,
    todosOpen,
    currentSessionId,
    selectedWorkAgentId,
    setTab,
    toggleSessions,
    toggleTodos,
    setCurrentSessionId,
    setSelectedWorkAgentId,
  } = useAppStore();

  const serverConnected = useServerConnection();

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => trpcClient.sessions.list.query(),
    refetchInterval: 5000,
  });

  const todosQuery = useQuery({
    queryKey: ['todos'],
    queryFn: () => trpcClient.todos.list.query(),
    refetchInterval: 3000,
  });

  const templatesQuery = useQuery({
    queryKey: ['agentTemplates'],
    queryFn: () => trpcClient.agentTemplates.list.query(),
  });

  const workflowsQuery = useQuery({
    queryKey: ['workflowTemplates'],
    queryFn: () => trpcClient.workflowTemplates.list.query(),
  });

  const boardQuery = useQuery({
    queryKey: ['board'],
    queryFn: () => trpcClient.board.get.query(),
    refetchInterval: 2500,
  });

  const workagentsQuery = useQuery({
    queryKey: ['workagents'],
    queryFn: () => trpcClient.workagents.list.query(),
    refetchInterval: 2500,
  });

  const reviewsQuery = useQuery({
    queryKey: ['reviews'],
    queryFn: () => trpcClient.reviews.list.query(),
    refetchInterval: 2500,
  });

  const outputsQuery = useQuery({
    queryKey: ['outputs'],
    queryFn: () => trpcClient.outputs.list.query(),
    refetchInterval: 2500,
  });

  const historyQuery = useQuery({
    queryKey: ['history'],
    queryFn: () => trpcClient.history.list.query({ stream: 'history' }),
    refetchInterval: 2500,
  });

  const activeSessionQuery = useQuery({
    queryKey: ['session', currentSessionId],
    queryFn: () => trpcClient.sessions.get.query({ sessionId: currentSessionId! }),
    enabled: Boolean(currentSessionId),
  });

  const persistedMessages = activeSessionQuery.data?.messages ?? [];
  const displayedMessages = useMemo(() => {
    if (!isStreaming || streamingAssistantContent.length === 0) {
      return persistedMessages;
    }

    const streamingMessage = {
      id: 'streaming_assistant',
      role: 'assistant',
      content: streamingAssistantContent,
      timestamp: Date.now(),
    };
    return [...persistedMessages, streamingMessage];
  }, [isStreaming, persistedMessages, streamingAssistantContent]);
  const chatMessages = useMemo(
    () =>
      displayedMessages.map((message) => {
        const role: 'user' | 'assistant' | 'system' =
          message.role === 'user' || message.role === 'assistant' || message.role === 'system'
            ? message.role
            : 'assistant';
        return {
          id: message.id,
          role,
          content: message.content,
        };
      }),
    [displayedMessages]
  );
  const messageCount = displayedMessages.length;
  const sessionCount = sessionsQuery.data?.length ?? 0;
  const allTodos = todosQuery.data ?? [];
  const todoCount = allTodos.length;
  const pendingTodoCount = allTodos.filter(
    (todo) => todo.status === 'pending' || todo.status === 'in_progress'
  ).length;
  const activeSessionLabel = activeSessionQuery.data?.title ?? currentSessionId ?? 'No active session';

  const selectedWorkAgent = useMemo(() => {
    return workagentsQuery.data?.find((agent) => agent.id === selectedWorkAgentId) ?? null;
  }, [selectedWorkAgentId, workagentsQuery.data]);

  const refreshDomainData = async () => {
    await Promise.all([
      queryClientInstance.invalidateQueries({ queryKey: ['agentTemplates'] }),
      queryClientInstance.invalidateQueries({ queryKey: ['workflowTemplates'] }),
      queryClientInstance.invalidateQueries({ queryKey: ['board'] }),
      queryClientInstance.invalidateQueries({ queryKey: ['workagents'] }),
      queryClientInstance.invalidateQueries({ queryKey: ['reviews'] }),
      queryClientInstance.invalidateQueries({ queryKey: ['outputs'] }),
      queryClientInstance.invalidateQueries({ queryKey: ['history'] }),
    ]);
  };

  const createSession = useMutation({
    mutationFn: async () => {
      const created = await trpcClient.sessions.create.mutate();
      await trpcClient.sessions.resume.mutate({ sessionId: created.id });
      return created;
    },
    onSuccess: (created) => {
      setCurrentSessionId(created.id);
      void Promise.all([
        queryClientInstance.invalidateQueries({ queryKey: ['sessions'] }),
        queryClientInstance.invalidateQueries({ queryKey: ['session', created.id] }),
      ]);
    },
    onError: (error) => {
      console.error('Failed to create session:', error);
    },
  });

  const createTodo = useMutation({
    mutationFn: (title: string) => trpcClient.todos.create.mutate({ title }),
    onSuccess: () => {
      void queryClientInstance.invalidateQueries({ queryKey: ['todos'] });
    },
  });

  const updateTodo = useMutation({
    mutationFn: (payload: { id: string; status: TodoItem['status'] }) =>
      trpcClient.todos.update.mutate(payload),
    onSuccess: () => {
      void queryClientInstance.invalidateQueries({ queryKey: ['todos'] });
    },
  });

  const deleteTodo = useMutation({
    mutationFn: (id: string) => trpcClient.todos.delete.mutate({ id }),
    onSuccess: () => {
      void queryClientInstance.invalidateQueries({ queryKey: ['todos'] });
    },
  });

  useEffect(() => {
    if (!sessionsQuery.data) return;
    if (sessionsQuery.data.length === 0) {
      if (currentSessionId !== null) {
        setCurrentSessionId(null);
      }
      return;
    }

    if (!currentSessionId || !sessionsQuery.data.some((session) => session.id === currentSessionId)) {
      const firstSessionId = sessionsQuery.data[0]?.id ?? null;
      setCurrentSessionId(firstSessionId);
      if (firstSessionId) {
        void trpcClient.sessions.resume.mutate({ sessionId: firstSessionId });
      }
    }
  }, [currentSessionId, sessionsQuery.data, setCurrentSessionId]);

  const appendMessageToSession = async (
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ) => {
    if (!content.trim()) return;
    await trpcClient.sessions.addMessage.mutate({ sessionId, role, content });
    await Promise.all([
      queryClientInstance.invalidateQueries({ queryKey: ['session', sessionId] }),
      queryClientInstance.invalidateQueries({ queryKey: ['sessions'] }),
    ]);
  };

  const handleChatSubmit = (prompt: string) => {
    if (!currentSessionId || isStreaming) return;

    const sessionId = currentSessionId;
    void (async () => {
      await appendMessageToSession(sessionId, 'user', prompt);

      streamStateRef.current = { assistant: '', canceled: false };
      setStreamingAssistantContent('');
      setIsStreaming(true);

      const cancel = streamQuery(
        prompt,
        (token) => {
          if (!streamStateRef.current || streamStateRef.current.canceled) return;
          streamStateRef.current.assistant += token;
          setStreamingAssistantContent(streamStateRef.current.assistant);
        },
        () => {
          void (async () => {
            const state = streamStateRef.current;
            streamStateRef.current = null;
            setIsStreaming(false);
            setStreamCancel(null);
            setStreamingAssistantContent('');

            if (!state || state.canceled) return;
            await appendMessageToSession(sessionId, 'assistant', state.assistant);
          })();
        },
        (error) => {
          void (async () => {
            const state = streamStateRef.current;
            streamStateRef.current = null;
            setIsStreaming(false);
            setStreamCancel(null);
            setStreamingAssistantContent('');

            if (!state || state.canceled) return;
            await appendMessageToSession(sessionId, 'assistant', `Error: ${error}`);
          })();
        }
      );

      setStreamCancel(() => cancel);
    })();
  };

  const handleCancelStream = () => {
    if (streamStateRef.current) {
      streamStateRef.current.canceled = true;
    }
    if (streamCancel) {
      streamCancel();
    }
    setStreamCancel(null);
    setIsStreaming(false);
    setStreamingAssistantContent('');
  };

  const renderTabContent = (): React.ReactElement => {
    switch (tab) {
      case 'chat':
        return (
          <ChatView
            messages={chatMessages}
            isStreaming={isStreaming}
            canChat={Boolean(currentSessionId)}
            activeSessionTitle={activeSessionQuery.data?.title ?? currentSessionId ?? undefined}
            onSubmit={handleChatSubmit}
            onCancel={handleCancelStream}
            onCreateSession={() => createSession.mutate()}
          />
        );
      case 'templates':
        return (
          <TemplateManagerView
            templates={templatesQuery.data ?? []}
            onAfterChange={refreshDomainData}
          />
        );
      case 'workflows':
        return (
          <WorkflowManagerView
            workflows={workflowsQuery.data ?? []}
            onAfterChange={refreshDomainData}
          />
        );
      case 'board':
        return (
          <BoardView
            board={boardQuery.data}
            outputs={outputsQuery.data ?? []}
            selectedWorkAgent={selectedWorkAgent}
            onSelectWorkAgent={setSelectedWorkAgentId}
            onAfterChange={refreshDomainData}
          />
        );
      case 'reviews':
        return (
          <ReviewQueueView
            reviews={reviewsQuery.data ?? []}
            onAfterChange={refreshDomainData}
          />
        );
      case 'history':
        return <HistoryView events={historyQuery.data ?? []} />;
      default:
        return <div className="p-4 text-sm text-zinc-500">Unknown tab</div>;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-100 text-zinc-900">
      <AppSidebar
        currentTab={tab}
        onTabChange={setTab}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopBar
          activeSessionLabel={activeSessionLabel}
          sessionsOpen={sessionsOpen}
          todosOpen={todosOpen}
          sessionCount={sessionCount}
          todoCount={todoCount}
          pendingTodoCount={pendingTodoCount}
          onCreateSession={() => createSession.mutate()}
          onToggleSessions={toggleSessions}
          onToggleTodos={toggleTodos}
        />

        {!serverConnected ? (
          <div className="px-6 py-3">
            <Alert>
              <AlertDescription>
                Server not connected. Run <code>bun run server</code>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <main className="flex min-h-0 flex-1 overflow-hidden">
          {sessionsOpen ? (
            <SessionsPanel
              sessions={sessionsQuery.data ?? []}
              activeSessionId={currentSessionId}
              onCreate={() => createSession.mutate()}
              onResume={async (sessionId) => {
                await trpcClient.sessions.resume.mutate({ sessionId });
                setCurrentSessionId(sessionId);
                await queryClientInstance.invalidateQueries({ queryKey: ['session', sessionId] });
              }}
              onFork={async (sessionId) => {
                const forked = await trpcClient.sessions.fork.mutate({ sessionId });
                await trpcClient.sessions.resume.mutate({ sessionId: forked.id });
                setCurrentSessionId(forked.id);
                await Promise.all([
                  queryClientInstance.invalidateQueries({ queryKey: ['sessions'] }),
                  queryClientInstance.invalidateQueries({ queryKey: ['session', forked.id] }),
                ]);
              }}
              onDelete={async (sessionId) => {
                await trpcClient.sessions.delete.mutate({ sessionId });
                if (currentSessionId === sessionId) {
                  setCurrentSessionId(null);
                }
                await Promise.all([
                  queryClientInstance.invalidateQueries({ queryKey: ['sessions'] }),
                  queryClientInstance.invalidateQueries({ queryKey: ['session', sessionId] }),
                ]);
              }}
              onClose={toggleSessions}
            />
          ) : null}

          <div className="min-w-0 flex-1 overflow-hidden">{renderTabContent()}</div>

          {todosOpen ? (
            <TodosPanel
              todos={todosQuery.data ?? []}
              onCreate={(title) => createTodo.mutate(title)}
              onUpdateStatus={(id, status) => updateTodo.mutate({ id, status })}
              onDelete={(id) => deleteTodo.mutate(id)}
              onClose={toggleTodos}
            />
          ) : null}
        </main>

        <StatusBar isStreaming={isStreaming} messageCount={messageCount} />
      </div>
    </div>
  );
}

export default function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
