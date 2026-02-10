import React from 'react';
import type { FieldWidgetType, UiSchemaField } from '@services/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  parseTags,
  selectOptions,
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

// eslint-disable-next-line complexity
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
          value={typeof props.value === 'string' ? props.value : ''}
          onValueChange={(val) => props.onChange(val)}
        >
          <SelectTrigger id={props.inputId}>
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case 'multiselect':
    case 'tags': {
      let currentTags: string[] = [];
      if (typeof props.value === 'string') currentTags = parseTags(props.value);
      else if (Array.isArray(props.value)) currentTags = props.value as string[];
      return (
        <Input
          id={props.inputId}
          value={currentTags.join(', ')}
          placeholder={props.uiField.placeholder ?? 'Comma-separated values'}
          onChange={(event) => props.onChange(parseTags(event.target.value))}
        />
      );
    }

    case 'checkbox':
      return (
        <Checkbox
          id={props.inputId}
          checked={Boolean(props.value)}
          onCheckedChange={(checked) => props.onChange(Boolean(checked))}
        />
      );

    case 'switch':
      return (
        <Switch
          id={props.inputId}
          checked={Boolean(props.value)}
          onCheckedChange={(checked) => props.onChange(Boolean(checked))}
        />
      );

    case 'json':
      return (
        <Textarea
          id={props.inputId}
          className="min-h-[120px] font-mono text-sm"
          value={typeof props.value === 'string' ? props.value : JSON.stringify(props.value ?? null, null, 2)}
          placeholder="{}"
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
      return <p className="text-sm text-destructive">Unsupported widget: {props.widget}</p>;
  }
}
