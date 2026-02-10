import React from 'react';
import type { FormDefinition } from '@services/types';
import FormFieldControl from '@ui/components/forms/FormFieldControl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  fieldOrder,
  resolveWidget,
  SUPPORTED_WIDGETS,
  type JsonSchemaField,
} from '@ui/components/forms/formUtils';

export interface DynamicFormRendererProps {
  definition: FormDefinition;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors?: string[];
}

export default function DynamicFormRenderer(props: DynamicFormRendererProps): React.ReactElement {
  const order = fieldOrder(props.definition);
  const schemaProperties = (props.definition.schema.properties ?? {}) as Record<string, JsonSchemaField>;

  const setField = (field: string, nextValue: unknown) => {
    props.onChange({
      ...props.value,
      [field]: nextValue,
    });
  };

  return (
    <div className="space-y-4">
      {props.definition.uiSchema.title && (
        <Card>
          <CardHeader>
            <CardTitle>{props.definition.uiSchema.title}</CardTitle>
            {props.definition.uiSchema.description && (
              <CardDescription>{props.definition.uiSchema.description}</CardDescription>
            )}
          </CardHeader>
        </Card>
      )}

      {order.map((field) => {
        const uiField = props.definition.uiSchema.fields[field] ?? {};
        const schemaField = schemaProperties[field] ?? {};
        const widget = resolveWidget(uiField, schemaField);
        const fieldId = `dynamic-field-${field}`;

        if (!SUPPORTED_WIDGETS.has(widget)) {
          return (
            <Alert key={field} variant="destructive">
              <AlertDescription>
                Unsupported widget `{widget}` for field `{field}`.
              </AlertDescription>
            </Alert>
          );
        }

        return (
          <div key={field} className="space-y-2">
            <Label htmlFor={fieldId}>{uiField.label ?? field}</Label>
            {uiField.description && <div className="text-xs text-muted-foreground">{uiField.description}</div>}
            <FormFieldControl
              inputId={fieldId}
              field={field}
              widget={widget}
              value={props.value[field]}
              uiField={uiField}
              schemaField={schemaField}
              onChange={(nextValue) => setField(field, nextValue)}
            />
          </div>
        );
      })}

      {props.errors && props.errors.length > 0 && (
        <Alert variant="destructive">
          <ul className="list-disc pl-5">
            {props.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
