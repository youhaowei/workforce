import React from 'react';
import type { FieldWidgetType, UiSchemaField } from '@services/types';
import { Checkbox, Input, Select, Textarea } from '@ui/components/ui';
import {
  parseTags,
  selectOptions,
  toStringArray,
  type JsonSchemaField,
} from './formUtils';

interface FormFieldControlProps {
  inputId: string;
  field: string;
  widget: FieldWidgetType;
  value: unknown;
  uiField: UiSchemaField;
  schemaField: JsonSchemaField;
  onChange: (nextValue: unknown) => void;
}

export default function FormFieldControl(props: FormFieldControlProps): React.ReactElement {
  switch (props.widget) {
    case 'text':
      return (
        <Input
          id={props.inputId}
          value={typeof props.value === 'string' ? props.value : ''}
          placeholder={props.uiField.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
        />
      );

    case 'textarea':
      return (
        <Textarea
          id={props.inputId}
          className="min-h-[96px]"
          value={typeof props.value === 'string' ? props.value : ''}
          placeholder={props.uiField.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
        />
      );

    case 'number':
      return (
        <Input
          id={props.inputId}
          type="number"
          value={typeof props.value === 'number' ? props.value : 0}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
      );

    case 'select': {
      const options = selectOptions(props.uiField, props.schemaField);
      return (
        <Select
          id={props.inputId}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(event) => props.onChange(event.target.value)}
        >
          <option value="">Select an option</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    }

    case 'multiselect':
      return (
        <Select
          id={props.inputId}
          multiple
          className="min-h-[96px] h-auto"
          value={toStringArray(props.value)}
          onChange={(event) => {
            const selectedValues = Array.from(event.target.selectedOptions).map((option) => option.value);
            props.onChange(selectedValues);
          }}
        >
          {selectOptions(props.uiField, props.schemaField).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );

    case 'checkbox':
    case 'switch':
      return (
        <Checkbox
          id={props.inputId}
          checked={Boolean(props.value)}
          onCheckedChange={(checked) => props.onChange(Boolean(checked))}
        />
      );

    case 'tags':
      return (
        <Input
          id={props.inputId}
          value={toStringArray(props.value).join(', ')}
          placeholder="item1, item2"
          onChange={(event) => props.onChange(parseTags(event.target.value))}
        />
      );

    case 'json':
      return (
        <Textarea
          id={props.inputId}
          className="min-h-[168px] font-mono text-xs"
          value={JSON.stringify(props.value ?? [], null, 2)}
          onChange={(event) => {
            try {
              props.onChange(JSON.parse(event.target.value));
            } catch {
              props.onChange(event.target.value);
            }
          }}
        />
      );

    default:
      return <></>;
  }
}
