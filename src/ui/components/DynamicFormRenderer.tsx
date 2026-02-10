import React from 'react';
import type { FormDefinition } from '@services/types';
import FormFieldControl from '@ui/components/forms/FormFieldControl';
import { Alert, AlertDescription, Card, CardDescription, CardHeader, CardTitle, Label } from '@ui/components/ui';
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

export function validateForm(definition: FormDefinition, value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const schema = definition.schema as {
    required?: string[];
    properties?: Record<string, JsonSchemaField>;
  };

  for (const field of schema.required ?? []) {
    const fieldValue = value[field];
    if (fieldValue == null || fieldValue === '' || (Array.isArray(fieldValue) && fieldValue.length === 0)) {
      errors.push(`${field} is required.`);
    }
  }

  for (const [field, spec] of Object.entries(schema.properties ?? {})) {
    const fieldValue = value[field];
    if (spec.type === 'string' && typeof fieldValue === 'string' && spec.minLength && fieldValue.length < spec.minLength) {
      errors.push(`${field} must be at least ${spec.minLength} characters.`);
    }
  }

  return errors;
}

function UnsupportedWidgetError(props: { field: string; widget: string }): React.ReactElement {
  return (
    <Alert variant="destructive">
      <AlertDescription>
        Unsupported widget `{props.widget}` for field `{props.field}`.
      </AlertDescription>
    </Alert>
  );
}

function ValidationErrors(props: { errors: string[] }): React.ReactElement {
  return (
    <Alert variant="destructive">
      <ul className="list-disc pl-5">
        {props.errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </Alert>
  );
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
      {props.definition.uiSchema.title ? (
        <Card>
          <CardHeader>
            <CardTitle>{props.definition.uiSchema.title}</CardTitle>
            {props.definition.uiSchema.description ? (
              <CardDescription>{props.definition.uiSchema.description}</CardDescription>
            ) : null}
          </CardHeader>
        </Card>
      ) : null}

      {order.map((field) => {
        const uiField = props.definition.uiSchema.fields[field] ?? {};
        const schemaField = schemaProperties[field] ?? {};
        const widget = resolveWidget(uiField, schemaField);
        const fieldId = `dynamic-field-${field}`;

        if (!SUPPORTED_WIDGETS.has(widget)) {
          return <UnsupportedWidgetError key={field} field={field} widget={widget} />;
        }

        return (
          <div key={field} className="space-y-2">
            <Label htmlFor={fieldId}>{uiField.label ?? field}</Label>
            {uiField.description ? <div className="text-xs text-zinc-500">{uiField.description}</div> : null}
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

      {props.errors && props.errors.length > 0 ? <ValidationErrors errors={props.errors} /> : null}
    </div>
  );
}
