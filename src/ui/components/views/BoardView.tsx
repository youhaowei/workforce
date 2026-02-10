import React from 'react';
import { trpcClient } from '@bridge/index';
import type { WorkAgentState } from '@services/types';
import type { BoardData, OutputItem, WorkAgent } from '@ui/types/domain';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@ui/components/ui';

interface BoardViewProps {
  board: BoardData | undefined;
  outputs: OutputItem[];
  selectedWorkAgent: WorkAgent | null;
  onSelectWorkAgent: (id: string | null) => void;
  onAfterChange: () => Promise<void>;
}

const BOARD_STATES: WorkAgentState[] = ['active', 'paused', 'completed', 'failed'];

export default function BoardView(props: BoardViewProps): React.ReactElement {
  const transition = async (id: string, action: 'pause' | 'resume' | 'cancel') => {
    if (action === 'pause') {
      await trpcClient.workagents.pause.mutate({ id, reason: 'Manual pause from board' });
    }
    if (action === 'resume') {
      await trpcClient.workagents.resume.mutate({ id });
    }
    if (action === 'cancel') {
      await trpcClient.workagents.cancel.mutate({ id });
    }
    await props.onAfterChange();
  };

  const decideOutput = async (id: string, decision: 'merge' | 'keep' | 'archive') => {
    await trpcClient.outputs.decide.mutate({ id, decision });
    await props.onAfterChange();
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">Supervision Board</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_STATES.map((state) => (
          <Card key={state}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                {state}
              </CardTitle>
              <CardDescription>
                <Badge variant="outline">{props.board?.counts[state] ?? 0} agents</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {(props.board?.lanes[state] ?? []).map((agent) => (
                <Card key={agent.id} className="border-zinc-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{agent.title}</CardTitle>
                    <CardDescription>{agent.goal}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => props.onSelectWorkAgent(agent.id)}>
                        Detail
                      </Button>
                      {state === 'active' ? (
                        <Button size="sm" variant="secondary" onClick={() => void transition(agent.id, 'pause')}>
                          Pause
                        </Button>
                      ) : null}
                      {state === 'paused' ? (
                        <Button size="sm" variant="secondary" onClick={() => void transition(agent.id, 'resume')}>
                          Resume
                        </Button>
                      ) : null}
                      {state !== 'completed' ? (
                        <Button size="sm" variant="destructive" onClick={() => void transition(agent.id, 'cancel')}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {props.selectedWorkAgent ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Agent Detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>ID: {props.selectedWorkAgent.id}</div>
            <div>State: {props.selectedWorkAgent.state}</div>
            <div>Goal: {props.selectedWorkAgent.goal}</div>
            <div>Pause reason: {props.selectedWorkAgent.pauseReason ?? '-'}</div>
            <div>Children: {props.selectedWorkAgent.childIds.length}</div>
            <Button className="mt-3" variant="outline" onClick={() => props.onSelectWorkAgent(null)}>
              Close Detail
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Work Outputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {props.outputs.map((output) => (
            <Card key={output.id} className="border-zinc-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{output.branchName}</CardTitle>
                <CardDescription>{output.status}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void decideOutput(output.id, 'merge')}>
                    Merge
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void decideOutput(output.id, 'keep')}>
                    Keep
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void decideOutput(output.id, 'archive')}>
                    Archive
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
