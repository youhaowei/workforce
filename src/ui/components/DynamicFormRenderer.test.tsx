import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DynamicFormRenderer, { validateForm } from './DynamicFormRenderer';
import type { FormDefinition } from '@services/types';

const definition: FormDefinition = {
  entity: 'agent-template',
  version: 'v-test',
  updatedAt: Date.now(),
  schema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      skills: { type: 'array', items: { type: 'string' } },
      reasoningIntensity: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
  },
  uiSchema: {
    order: ['name', 'skills', 'reasoningIntensity'],
    fields: {
      name: { widget: 'text', label: 'Name' },
      skills: { widget: 'tags', label: 'Skills' },
      reasoningIntensity: {
        widget: 'select',
        label: 'Reasoning Intensity',
        options: [
          { label: 'Low', value: 'low' },
          { label: 'Medium', value: 'medium' },
          { label: 'High', value: 'high' },
        ],
      },
    },
  },
};

describe('DynamicFormRenderer', () => {
  it('renders configured fields and updates values', () => {
    const onChange = vi.fn();

    render(
      <DynamicFormRenderer
        definition={definition}
        value={{ name: '', skills: [], reasoningIntensity: 'medium' }}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Reviewer' } });
    expect(onChange).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Skills'), { target: { value: 'git, tests' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('validates required fields', () => {
    const errors = validateForm(definition, { name: '', skills: [] });
    expect(errors.some((error) => error.includes('name is required'))).toBe(true);
  });
});
