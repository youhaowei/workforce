/**
 * TemplateService Tests
 *
 * Tests for agent template CRUD, validation, duplication, archiving, and migration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTemplateService } from './template';
import type { AgentProfile } from './types';

const TEST_DIR = join(tmpdir(), 'workforce-template-test-' + Date.now());
const WORKSPACE_ID = 'ws_test_workspace';

function sampleInput() {
  return {
    name: 'Code Reviewer',
    description: 'Reviews code for quality',
    systemPrompt: 'You are a code reviewer. Review code for bugs, style, and correctness.',
    skills: ['code-review'],
    tools: ['bash', 'read', 'write'],
    constraints: ['Do not modify code directly'],
    reasoningIntensity: 'high' as const,
  };
}

describe('TemplateService', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a template with generated ID', async () => {
      const service = createTemplateService(TEST_DIR);
      const tmpl = await service.create(WORKSPACE_ID, sampleInput());

      expect(tmpl.id).toMatch(/^tmpl_/);
      expect(tmpl.name).toBe('Code Reviewer');
      expect(tmpl.archived).toBe(false);
      expect(tmpl.createdAt).toBeLessThanOrEqual(Date.now());

      service.dispose();
    });
  });

  describe('get', () => {
    it('should return template by ID', async () => {
      const service = createTemplateService(join(TEST_DIR, 'get'));
      const created = await service.create(WORKSPACE_ID, sampleInput());
      const found = await service.get(WORKSPACE_ID, created.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Code Reviewer');

      service.dispose();
    });

    it('should return null for non-existent template', async () => {
      const service = createTemplateService(join(TEST_DIR, 'get-null'));
      const found = await service.get(WORKSPACE_ID, 'tmpl_nonexistent');

      expect(found).toBeNull();

      service.dispose();
    });
  });

  describe('update', () => {
    it('should update template properties', async () => {
      const service = createTemplateService(join(TEST_DIR, 'update'));
      const tmpl = await service.create(WORKSPACE_ID, sampleInput());

      const updated = await service.update(WORKSPACE_ID, tmpl.id, {
        name: 'Senior Reviewer',
        reasoningIntensity: 'max',
      });

      expect(updated.name).toBe('Senior Reviewer');
      expect(updated.reasoningIntensity).toBe('max');
      // Immutable fields preserved
      expect(updated.id).toBe(tmpl.id);
      expect(updated.createdAt).toBe(tmpl.createdAt);

      service.dispose();
    });

    it('should throw for non-existent template', async () => {
      const service = createTemplateService(join(TEST_DIR, 'update-throw'));
      await expect(
        service.update(WORKSPACE_ID, 'tmpl_fake', { name: 'X' })
      ).rejects.toThrow('Template not found');

      service.dispose();
    });
  });

  describe('duplicate', () => {
    it('should create a copy with new ID and (copy) suffix', async () => {
      const service = createTemplateService(join(TEST_DIR, 'duplicate'));
      const original = await service.create(WORKSPACE_ID, sampleInput());
      const copy = await service.duplicate(WORKSPACE_ID, original.id);

      expect(copy.id).not.toBe(original.id);
      expect(copy.name).toBe('Code Reviewer (copy)');
      expect(copy.systemPrompt).toBe(original.systemPrompt);
      expect(copy.archived).toBe(false);

      service.dispose();
    });
  });

  describe('archive', () => {
    it('should mark template as archived', async () => {
      const service = createTemplateService(join(TEST_DIR, 'archive'));
      const tmpl = await service.create(WORKSPACE_ID, sampleInput());

      await service.archive(WORKSPACE_ID, tmpl.id);
      const archived = await service.get(WORKSPACE_ID, tmpl.id);

      expect(archived!.archived).toBe(true);

      service.dispose();
    });

    it('should exclude archived from default list', async () => {
      const service = createTemplateService(join(TEST_DIR, 'archive-list'));
      await service.create(WORKSPACE_ID, sampleInput());
      const toArchive = await service.create(WORKSPACE_ID, {
        ...sampleInput(),
        name: 'Archived One',
      });
      await service.archive(WORKSPACE_ID, toArchive.id);

      const defaultList = await service.list(WORKSPACE_ID);
      expect(defaultList).toHaveLength(1);
      expect(defaultList[0].name).toBe('Code Reviewer');

      const fullList = await service.list(WORKSPACE_ID, { includeArchived: true });
      expect(fullList).toHaveLength(2);

      service.dispose();
    });
  });

  describe('list', () => {
    it('should return all templates', async () => {
      const service = createTemplateService(join(TEST_DIR, 'list'));

      await service.create(WORKSPACE_ID, { ...sampleInput(), name: 'First' });
      await service.create(WORKSPACE_ID, { ...sampleInput(), name: 'Second' });
      await service.create(WORKSPACE_ID, { ...sampleInput(), name: 'Third' });

      const list = await service.list(WORKSPACE_ID);
      expect(list).toHaveLength(3);
      const names = list.map((t) => t.name).sort();
      expect(names).toEqual(['First', 'Second', 'Third']);

      service.dispose();
    });
  });

  describe('validate', () => {
    it('should pass for valid template', () => {
      const service = createTemplateService(join(TEST_DIR, 'validate'));
      const result = service.validate(sampleInput());

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      service.dispose();
    });

    it('should fail for missing required fields', () => {
      const service = createTemplateService(join(TEST_DIR, 'validate-fail'));
      const result = service.validate({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.errors.map((e) => e.field)).toContain('name');
      expect(result.errors.map((e) => e.field)).toContain('description');
      expect(result.errors.map((e) => e.field)).toContain('systemPrompt');

      service.dispose();
    });

    it('should warn for empty tools and constraints', () => {
      const service = createTemplateService(join(TEST_DIR, 'validate-warn'));
      const result = service.validate({
        ...sampleInput(),
        tools: [],
        constraints: [],
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);

      service.dispose();
    });

    it('should reject invalid temperature', () => {
      const service = createTemplateService(join(TEST_DIR, 'validate-temp'));
      const result = service.validate({
        ...sampleInput(),
        temperature: 5.0,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.field)).toContain('temperature');

      service.dispose();
    });
  });

  describe('fromProfile', () => {
    it('should convert AgentProfile to AgentTemplate', () => {
      const service = createTemplateService(join(TEST_DIR, 'fromProfile'));
      const profile: AgentProfile = {
        id: 'old-id',
        name: 'Legacy Agent',
        description: 'An old-style agent profile',
        systemPrompt: 'You are a helpful assistant.',
        tools: ['bash', 'read'],
        temperature: 0.7,
        maxTokens: 4096,
      };

      const template = service.fromProfile(profile);

      expect(template.id).toMatch(/^tmpl_/);
      expect(template.name).toBe('Legacy Agent');
      expect(template.description).toBe('An old-style agent profile');
      expect(template.systemPrompt).toBe('You are a helpful assistant.');
      expect(template.tools).toEqual(['bash', 'read']);
      expect(template.skills).toEqual([]);
      expect(template.constraints).toEqual([]);
      expect(template.reasoningIntensity).toBe('medium');
      expect(template.temperature).toBe(0.7);
      expect(template.maxTokens).toBe(4096);
      expect(template.archived).toBe(false);

      service.dispose();
    });
  });

  describe('persistence across instances', () => {
    it('should load templates from disk on new instance', async () => {
      const dir = join(TEST_DIR, 'reload');

      const service1 = createTemplateService(dir);
      const tmpl = await service1.create(WORKSPACE_ID, sampleInput());
      service1.dispose();

      const service2 = createTemplateService(dir);
      const found = await service2.get(WORKSPACE_ID, tmpl.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Code Reviewer');

      service2.dispose();
    });
  });
});
