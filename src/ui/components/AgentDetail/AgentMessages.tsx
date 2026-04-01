/**
 * AgentMessages - Messages tab showing the agent's conversation history.
 */

import { ScrollArea } from "@/components/ui/scroll-area";
import type { Session } from "@/services/types";

interface AgentMessagesProps {
  session: Session;
}

export function AgentMessages({ session }: AgentMessagesProps) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 max-w-2xl pb-4">
        {session.messages.map((msg) => (
          <div
            key={msg.id}
            className={`p-3 rounded-lg text-sm ${
              msg.role === "user" ? "bg-palette-primary/5 ml-8" : "bg-neutral-bg-dim mr-8"
            }`}
          >
            <span className="text-[10px] font-medium text-neutral-fg-subtle">{msg.role}</span>
            <p className="mt-1 whitespace-pre-wrap">{msg.content}</p>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="mt-2 space-y-1">
                {msg.toolCalls.map((tc) => (
                  <div key={tc.id} className="text-xs font-mono bg-neutral-bg/50 px-2 py-1 rounded">
                    {tc.name}({Object.keys(tc.args).join(", ")})
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {session.messages.length === 0 && (
          <p className="text-sm text-neutral-fg-subtle text-center py-8">No messages yet</p>
        )}
      </div>
    </ScrollArea>
  );
}
