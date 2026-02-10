import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpcClient } from '@bridge/index';
import DynamicFormRenderer, { validateForm } from '@ui/components/DynamicFormRenderer';
import type { FormDefinition } from '@services/types';
import type { WorkflowTemplate } from '@ui/types/domain';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/ui';

interface WorkflowManagerViewProps {
  workflows: WorkflowTemplate[];
  onAfterChange: () => Promise<void>;
}

export default function WorkflowManagerView(props: WorkflowManagerViewProps): React.ReactElement {
  const [form, setForm] = useState<Record<string, unknown>>({ steps: [] });
  const [errors, setErrors] = useState<string[]>([]);

  const definitionQuery = useQuery({
    queryKey: ['form-definition', 'workflow-template'],
    queryFn: () => trpcClient.formDefinitions.get.query({ entity: 'workflow-template' }),
  });

  const createMutation = useMutation({
    mutationFn: () => trpcClient.workflowTemplates.create.mutate(form as never),
    onSuccess: async () => {
      setForm({ steps: [] });
      setErrors([]);
      await props.onAfterChange();
    },
  });

  const runWorkflow = async (id: string) => {
    await trpcClient.workflowTemplates.run.mutate({ id, goal: 'Execute workflow for MVP dogfood.' });
    await props.onAfterChange();
  };

  const archiveWorkflow = async (id: string) => {
    await trpcClient.workflowTemplates.archive.mutate({ id });
    await props.onAfterChange();
  };

  const definition = definitionQuery.data as FormDefinition | undefined;

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">Workflow Templates</h2>
      {definition ? (
        <Card>
          <CardContent className="p-4">
            <DynamicFormRenderer definition={definition} value={form} onChange={setForm} errors={errors} />
            <div className="mt-4">
              <Button
                onClick={() => {
                  const validationErrors = validateForm(definition, form);
                  setErrors(validationErrors);
                  if (validationErrors.length === 0) {
                    createMutation.mutate();
                  }
                }}
              >
                Save Workflow
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="text-sm text-zinc-500">Loading form definition...</div>
      )}

      <div className="mt-6 space-y-2">
        {props.workflows.map((workflow) => (
          <Card key={workflow.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{workflow.name}</CardTitle>
              <CardDescription>{workflow.description}</CardDescription>
              <div className="text-xs text-zinc-500">{workflow.steps.length} steps</div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void runWorkflow(workflow.id)}>
                  Run
                </Button>
                <Button size="sm" variant="outline" onClick={() => void archiveWorkflow(workflow.id)}>
                  Archive
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
