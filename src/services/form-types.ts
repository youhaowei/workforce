/**
 * Form / Schema Types (for DynamicFormRenderer)
 *
 * Extracted from types.ts to reduce file size.
 */

export type FieldWidgetType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'number'
  | 'checkbox'
  | 'switch'
  | 'tags'
  | 'json';

export interface UiSchemaField {
  widget?: FieldWidgetType;
  label?: string;
  description?: string;
  placeholder?: string;
  section?: string;
  order?: number;
  options?: Array<{ label: string; value: string }>;
}

export interface UiSchema {
  title?: string;
  description?: string;
  order?: string[];
  fields: Record<string, UiSchemaField>;
}

export interface FormDefinition {
  entity: string;
  schema: Record<string, unknown>;
  uiSchema: UiSchema;
  version: string;
  updatedAt: number;
}
