import { z } from 'zod';

export const agentTemplateInput = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  reasoningIntensity: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const workflowStepInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  templateId: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  parallelGroup: z.string().optional(),
  reviewGate: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

export const workflowTemplateInput = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  steps: z.array(workflowStepInput).min(1),
});
