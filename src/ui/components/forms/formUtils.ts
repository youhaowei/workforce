import type { FieldWidgetType, FormDefinition, UiSchemaField } from '@services/form-types';

export interface JsonSchemaField {
  type?: string;
  enum?: string[];
  minLength?: number;
}

export const SUPPORTED_WIDGETS = new Set<FieldWidgetType>([
  'text',
  'textarea',
  'select',
  'multiselect',
  'number',
  'checkbox',
  'switch',
  'tags',
  'json',
]);

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item));
}

export function parseTags(rawValue: string): string[] {
  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function fieldOrder(definition: FormDefinition): string[] {
  if (definition.uiSchema.order && definition.uiSchema.order.length > 0) {
    return definition.uiSchema.order;
  }

  const schemaProps = (definition.schema.properties ?? {}) as Record<string, unknown>;
  return Object.keys(schemaProps);
}

export function resolveWidget(uiField: UiSchemaField, schemaField: JsonSchemaField): FieldWidgetType {
  if (uiField.widget) {
    return uiField.widget;
  }

  return schemaField.type === 'boolean' ? 'checkbox' : 'text';
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

export function selectOptions(uiField: UiSchemaField, schemaField: JsonSchemaField) {
  if (uiField.options) {
    return uiField.options;
  }

  return (schemaField.enum ?? []).map((value) => ({
    label: value,
    value,
  }));
}
