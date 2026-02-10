import React from 'react';
import { Badge } from '@ui/components/ui';

interface StatusBarProps {
  isStreaming: boolean;
  messageCount: number;
}

export default function StatusBar(props: StatusBarProps): React.ReactElement {
  return (
    <footer className="flex items-center justify-between border-t border-zinc-200 bg-white px-6 py-2 text-xs text-zinc-600">
      <Badge variant={props.isStreaming ? 'secondary' : 'outline'}>
        {props.isStreaming ? 'Thinking...' : 'Ready'}
      </Badge>
      <span>{props.messageCount} messages</span>
    </footer>
  );
}
