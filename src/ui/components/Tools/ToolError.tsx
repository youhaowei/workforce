/**
 * ToolError - Tool error display with expandable details.
 */

import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

interface ToolErrorProps {
  toolName: string;
  error: string;
  stackTrace?: string;
  args?: unknown;
}

export default function ToolError({ toolName, error, stackTrace, args }: ToolErrorProps) {
  const [showDetails, setShowDetails] = useState(false);

  const hasDetails = Boolean(stackTrace || args);

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle className="font-mono text-sm">{toolName} failed</AlertTitle>
      <AlertDescription className="mt-1">
        <p className="text-sm">{error}</p>

        {hasDetails && (
          <div className="mt-2">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setShowDetails((prev) => !prev)}
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </Button>

            {showDetails && (
              <div className="mt-2 space-y-2">
                {stackTrace && (
                  <pre className="font-mono text-xs whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto bg-destructive/10 p-2 rounded">
                    {stackTrace}
                  </pre>
                )}
                {args != null ? (
                  <div className="font-mono text-xs">
                    <strong>Arguments:</strong>
                    <pre className="whitespace-pre-wrap overflow-x-auto">{String(JSON.stringify(args, null, 2))}</pre>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
