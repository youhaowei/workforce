import { readFile, watch } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { getEventBus } from '@shared/event-bus';
import type { FieldWidgetType, FormDefinition, UiSchema } from './types';
import { getWorkspaceService } from './workspace';

const ALLOWED_WIDGETS = [
  'text',
  'textarea',
  'select',
  'multiselect',
  'number',
  'checkbox',
  'switch',
  'tags',
  'json',
] as const satisfies readonly FieldWidgetType[];

const UiFieldSchema = z.object({
  widget: z.enum(ALLOWED_WIDGETS).optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  section: z.string().optional(),
  order: z.number().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
});

const UiSchemaSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  order: z.array(z.string()).optional(),
  fields: z.record(UiFieldSchema),
});

export interface FormValidationResult {
  valid: boolean;
  errors: string[];
}

class FormDefinitionService {
  private watchers = new Map<string, AbortController>();

  private async definitionRoot(): Promise<{ workspaceId: string; root: string }> {
    const workspace = await getWorkspaceService().getCurrent();
    return {
      workspaceId: workspace.id,
      root: join(workspace.rootPath, 'definitions', 'forms'),
    };
  }

  async get(entity: string): Promise<FormDefinition> {
    const { root } = await this.definitionRoot();
    const schemaPath = join(root, `${entity}.schema.json`);
    const uiPath = join(root, `${entity}.ui.json`);

    const [schemaRaw, uiRaw] = await Promise.all([
      readFile(schemaPath, 'utf-8'),
      readFile(uiPath, 'utf-8'),
    ]);

    const schema = JSON.parse(schemaRaw) as Record<string, unknown>;
    const uiSchemaParsed = UiSchemaSchema.safeParse(JSON.parse(uiRaw));
    if (!uiSchemaParsed.success) {
      throw new Error(`Invalid uiSchema for ${entity}: ${uiSchemaParsed.error.message}`);
    }

    const definition: FormDefinition = {
      entity,
      schema,
      uiSchema: uiSchemaParsed.data as UiSchema,
      version: `v-${Date.now()}`,
      updatedAt: Date.now(),
    };

    return definition;
  }

  validate(definition: FormDefinition): FormValidationResult {
    const errors: string[] = [];

    const schemaObj = definition.schema as Record<string, unknown>;
    if (schemaObj.type !== 'object') {
      errors.push('Schema root type must be "object".');
    }

    const properties = schemaObj.properties;
    if (!properties || typeof properties !== 'object') {
      errors.push('Schema must include object properties.');
    }

    for (const [field, uiField] of Object.entries(definition.uiSchema.fields)) {
      if (uiField.widget && !ALLOWED_WIDGETS.includes(uiField.widget)) {
        errors.push(`Field ${field}: widget ${uiField.widget} is not allowlisted.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async watchEntity(entity: string): Promise<void> {
    const key = entity;
    if (this.watchers.has(key)) return;

    const { root, workspaceId } = await this.definitionRoot();
    const controller = new AbortController();
    this.watchers.set(key, controller);

    const bus = getEventBus();

    (async () => {
      for await (const _event of watch(root, { signal: controller.signal })) {
        bus.emit({
          type: 'FormDefinitionChanged',
          workspaceId,
          entity,
          version: `v-${Date.now()}`,
          timestamp: Date.now(),
        });
      }
    })().catch((err) => {
      if ((err as { name?: string }).name !== 'AbortError') {
        console.error('Form definition watch failed:', err);
      }
    });
  }

  stopWatch(entity: string): void {
    const watcher = this.watchers.get(entity);
    if (!watcher) return;
    watcher.abort();
    this.watchers.delete(entity);
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.abort();
    }
    this.watchers.clear();
  }
}

let _instance: FormDefinitionService | null = null;

export function getFormDefinitionService(): FormDefinitionService {
  return (_instance ??= new FormDefinitionService());
}

export function resetFormDefinitionService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

export { ALLOWED_WIDGETS };
