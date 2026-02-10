/**
 * WorkflowService Tests
 *
 * Tests for workflow CRUD, DAG validation, cycle detection,
 * and topological execution ordering.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWorkflowService } from './workflow';
import type { WorkflowService, WorkflowStep } from './types';

const TEST_DIR = join(tmpdir(), 'workforce-workflow-test-' + Date.now());
const WS_ID = 'ws_test';

function freshService(): WorkflowService {
  return createWorkflowService(TEST_DIR);
}

/** Build a minimal step */
function step(
  id: string,
  type: 'agent' | 'review_gate' | 'parallel_group' = 'agent',
  deps: string[] = [],
  extra: Partial<WorkflowStep> = {}
): WorkflowStep {
  return {
    id,
    name: `Step ${id}`,
    type,
    dependsOn: deps,
    templateId: type === 'agent' ? 'tpl_test' : undefined,
    reviewPrompt: type === 'review_gate' ? 'Review this' : undefined,
    ...extra,
  };
}

describe('WorkflowService', () => {
  beforeAll(async () => {
    await mkdir(join(TEST_DIR, WS_ID, 'workflows'), { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a workflow with generated ID', async () => {
      const service = freshService();
      const wf = await service.create(WS_ID, {
        name: 'Test Workflow',
        description: 'A test workflow',
        steps: [step('s1')],
      });

      expect(wf.id).toMatch(/^wf_/);
      expect(wf.name).toBe('Test Workflow');
      expect(wf.steps).toHaveLength(1);
      expect(wf.archived).toBe(false);
      expect(wf.createdAt).toBeLessThanOrEqual(Date.now());

      service.dispose();
    });

    it('should reject invalid workflow on creation', async () => {
      const service = freshService();

      await expect(
        service.create(WS_ID, {
          name: '',
          description: '',
          steps: [],
        })
      ).rejects.toThrow('Invalid workflow');

      service.dispose();
    });

    it('should reject workflow with cycles', async () => {
      const service = freshService();

      await expect(
        service.create(WS_ID, {
          name: 'Cyclic',
          description: '',
          steps: [step('a', 'agent', ['b']), step('b', 'agent', ['a'])],
        })
      ).rejects.toThrow('Cycle detected');

      service.dispose();
    });
  });

  describe('get', () => {
    it('should return workflow by ID', async () => {
      const service = freshService();
      const created = await service.create(WS_ID, {
        name: 'Get Test',
        description: '',
        steps: [step('s1')],
      });

      // Clear cache to test disk read
      service.dispose();
      const service2 = freshService();

      const found = await service2.get(WS_ID, created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Get Test');

      service2.dispose();
    });

    it('should return null for non-existent workflow', async () => {
      const service = freshService();
      const found = await service.get(WS_ID, 'wf_nonexistent');
      expect(found).toBeNull();
      service.dispose();
    });
  });

  describe('update', () => {
    it('should update workflow properties', async () => {
      const service = freshService();
      const wf = await service.create(WS_ID, {
        name: 'Original',
        description: '',
        steps: [step('s1')],
      });

      const updated = await service.update(WS_ID, wf.id, {
        name: 'Updated',
        description: 'New description',
      });

      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('New description');
      expect(updated.id).toBe(wf.id);
      expect(updated.createdAt).toBe(wf.createdAt);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(wf.updatedAt);

      service.dispose();
    });

    it('should validate steps on update', async () => {
      const service = freshService();
      const wf = await service.create(WS_ID, {
        name: 'Steps Test',
        description: '',
        steps: [step('s1')],
      });

      await expect(
        service.update(WS_ID, wf.id, {
          steps: [step('a', 'agent', ['b']), step('b', 'agent', ['a'])],
        })
      ).rejects.toThrow('Cycle detected');

      service.dispose();
    });

    it('should throw for non-existent workflow', async () => {
      const service = freshService();
      await expect(
        service.update(WS_ID, 'wf_fake', { name: 'X' })
      ).rejects.toThrow('Workflow not found');
      service.dispose();
    });
  });

  describe('list', () => {
    it('should list non-archived workflows', async () => {
      const dir = join(TEST_DIR, 'ws_list', 'workflows');
      await mkdir(dir, { recursive: true });
      const service = createWorkflowService(TEST_DIR);

      await service.create('ws_list', { name: 'WF1', description: '', steps: [step('s1')] });
      await service.create('ws_list', { name: 'WF2', description: '', steps: [step('s1')] });
      const wf3 = await service.create('ws_list', { name: 'WF3', description: '', steps: [step('s1')] });
      await service.archive('ws_list', wf3.id);

      const list = await service.list('ws_list');
      expect(list).toHaveLength(2);

      const withArchived = await service.list('ws_list', { includeArchived: true });
      expect(withArchived).toHaveLength(3);

      service.dispose();
    });
  });

  describe('archive', () => {
    it('should mark workflow as archived', async () => {
      const service = freshService();
      const wf = await service.create(WS_ID, {
        name: 'To Archive',
        description: '',
        steps: [step('s1')],
      });

      await service.archive(WS_ID, wf.id);

      const found = await service.get(WS_ID, wf.id);
      expect(found?.archived).toBe(true);

      service.dispose();
    });

    it('should throw for non-existent workflow', async () => {
      const service = freshService();
      await expect(service.archive(WS_ID, 'wf_fake')).rejects.toThrow('Workflow not found');
      service.dispose();
    });
  });

  describe('validate', () => {
    it('should accept a valid linear workflow', () => {
      const service = freshService();
      const result = service.validate({
        name: 'Linear',
        steps: [step('s1'), step('s2', 'agent', ['s1']), step('s3', 'review_gate', ['s2'])],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      service.dispose();
    });

    it('should accept a valid parallel workflow', () => {
      const service = freshService();
      const result = service.validate({
        name: 'Parallel',
        steps: [
          step('root'),
          step('a', 'agent', ['root']),
          step('b', 'agent', ['root']),
          step('c', 'agent', ['root']),
          step('join', 'review_gate', ['a', 'b', 'c']),
        ],
      });
      expect(result.valid).toBe(true);
      service.dispose();
    });

    it('should reject workflow with missing name', () => {
      const service = freshService();
      const result = service.validate({ name: '', steps: [step('s1')] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Workflow name is required');
      service.dispose();
    });

    it('should reject workflow with no steps', () => {
      const service = freshService();
      const result = service.validate({ name: 'Empty', steps: [] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Workflow must have at least one step');
      service.dispose();
    });

    it('should reject workflow with duplicate step IDs', () => {
      const service = freshService();
      const result = service.validate({
        name: 'Dups',
        steps: [step('s1'), step('s1')],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate step id'))).toBe(true);
      service.dispose();
    });

    it('should reject agent step without templateId', () => {
      const service = freshService();
      const result = service.validate({
        name: 'No Template',
        steps: [{ id: 's1', name: 'S1', type: 'agent', dependsOn: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('templateId'))).toBe(true);
      service.dispose();
    });

    it('should reject review_gate without reviewPrompt', () => {
      const service = freshService();
      const result = service.validate({
        name: 'No Prompt',
        steps: [{ id: 's1', name: 'S1', type: 'review_gate', dependsOn: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('reviewPrompt'))).toBe(true);
      service.dispose();
    });

    it('should detect cycles in complex DAG', () => {
      const service = freshService();
      // a → b → c → a (cycle)
      const result = service.validate({
        name: 'Complex Cycle',
        steps: [
          step('a', 'agent', ['c']),
          step('b', 'agent', ['a']),
          step('c', 'agent', ['b']),
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Cycle detected'))).toBe(true);
      service.dispose();
    });

    it('should detect non-existent dependencies', () => {
      const service = freshService();
      const result = service.validate({
        name: 'Bad Dep',
        steps: [step('s1', 'agent', ['missing'])],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('non-existent step'))).toBe(true);
      service.dispose();
    });
  });

  describe('getExecutionOrder', () => {
    it('should return correct order for linear workflow', async () => {
      const service = freshService();
      const wf = await service.create(WS_ID, {
        name: 'Linear Order',
        description: '',
        steps: [step('s1'), step('s2', 'agent', ['s1']), step('s3', 'agent', ['s2'])],
      });

      const order = await service.getExecutionOrder(WS_ID, wf.id);
      expect(order).toEqual([['s1'], ['s2'], ['s3']]);

      service.dispose();
    });

    it('should group parallel steps into batches', async () => {
      const service = freshService();
      const wf = await service.create(WS_ID, {
        name: 'Parallel Order',
        description: '',
        steps: [
          step('root'),
          step('a', 'agent', ['root']),
          step('b', 'agent', ['root']),
          step('c', 'agent', ['root']),
          step('join', 'review_gate', ['a', 'b', 'c']),
        ],
      });

      const order = await service.getExecutionOrder(WS_ID, wf.id);
      expect(order).toHaveLength(3); // root, [a,b,c], join
      expect(order[0]).toEqual(['root']);
      expect(order[1].sort()).toEqual(['a', 'b', 'c']);
      expect(order[2]).toEqual(['join']);

      service.dispose();
    });

    it('should handle diamond dependency pattern', async () => {
      const service = freshService();
      //   start
      //   /   \
      //  a     b
      //   \   /
      //   merge
      const wf = await service.create(WS_ID, {
        name: 'Diamond',
        description: '',
        steps: [
          step('start'),
          step('a', 'agent', ['start']),
          step('b', 'agent', ['start']),
          step('merge', 'agent', ['a', 'b']),
        ],
      });

      const order = await service.getExecutionOrder(WS_ID, wf.id);
      expect(order).toHaveLength(3);
      expect(order[0]).toEqual(['start']);
      expect(order[1].sort()).toEqual(['a', 'b']);
      expect(order[2]).toEqual(['merge']);

      service.dispose();
    });

    it('should throw for non-existent workflow', async () => {
      const service = freshService();
      await expect(
        service.getExecutionOrder(WS_ID, 'wf_nonexistent')
      ).rejects.toThrow('Workflow not found');
      service.dispose();
    });
  });
});
