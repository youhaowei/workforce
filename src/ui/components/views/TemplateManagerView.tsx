import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpcClient } from '@bridge/index';
import DynamicFormRenderer, { validateForm } from '@ui/components/DynamicFormRenderer';
import type { FormDefinition } from '@services/types';
import type { AgentTemplate } from '@ui/types/domain';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/ui';

interface TemplateManagerViewProps {
  templates: AgentTemplate[];
  onAfterChange: () => Promise<void>;
}

export default function TemplateManagerView(props: TemplateManagerViewProps): React.ReactElement {
  const [form, setForm] = useState<Record<string, unknown>>({ reasoningIntensity: 'medium' });
  const [errors, setErrors] = useState<string[]>([]);

  const definitionQuery = useQuery({
    queryKey: ['form-definition', 'agent-template'],
    queryFn: () => trpcClient.formDefinitions.get.query({ entity: 'agent-template' }),
  });

  const createMutation = useMutation({
    mutationFn: () => trpcClient.agentTemplates.create.mutate(form as never),
    onSuccess: async () => {
      setForm({ reasoningIntensity: 'medium' });
      setErrors([]);
      await props.onAfterChange();
    },
  });

  const runTemplate = async (id: string) => {
    await trpcClient.agentTemplates.run.mutate({ id, goal: 'Execute template for MVP dogfood.' });
    await props.onAfterChange();
  };

  const archiveTemplate = async (id: string) => {
    await trpcClient.agentTemplates.archive.mutate({ id });
    await props.onAfterChange();
  };

  const definition = definitionQuery.data as FormDefinition | undefined;

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">Agent Templates</h2>
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
                Save Template
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="text-sm text-zinc-500">Loading form definition...</div>
      )}

      <div className="mt-6 space-y-2">
        {props.templates.map((template) => (
          <Card key={template.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{template.name}</CardTitle>
              <CardDescription>{template.description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void runTemplate(template.id)}>
                  Run
                </Button>
                <Button size="sm" variant="outline" onClick={() => void archiveTemplate(template.id)}>
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
