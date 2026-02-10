import type { FieldWidgetType, FormDefinition, UiSchemaField } from '@services/types';

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

export function selectOptions(uiField: UiSchemaField, schemaField: JsonSchemaField) {
  if (uiField.options) {
    return uiField.options;
  }

  return (schemaField.enum ?? []).map((value) => ({
    label: value,
    value,
  }));
}
