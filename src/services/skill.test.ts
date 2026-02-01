/**
 * Skill Service Tests
 *
 * Tests for skill loading, parsing, and management.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resetSkillService,
  createSkillService,
  parseSkillFile,
  parseFrontmatter,
} from './skill';

// Test directory for skill files
const TEST_DIR = join(tmpdir(), 'fuxi-skill-test-' + Date.now());

describe('SkillService', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetSkillService();
  });

  afterEach(() => {
    resetSkillService();
  });

  describe('parseSkillFile', () => {
    it('should parse skill with frontmatter', () => {
      const content = `---
name: git-master
description: Expert git workflow knowledge
version: 1
tags: [git, workflow]
---

You are an expert in Git workflows...`;

      const skill = parseSkillFile(content, 'test.md');

      expect(skill.name).toBe('git-master');
      expect(skill.description).toBe('Expert git workflow knowledge');
      expect(skill.tags).toEqual(['git', 'workflow']);
      expect(skill.content).toBe('You are an expert in Git workflows...');
    });

    it('should parse skill without frontmatter', () => {
      const content = 'Just some skill content without frontmatter.';
      const skill = parseSkillFile(content, 'my-skill.md');

      expect(skill.name).toBe('my-skill');
      expect(skill.description).toBe('');
      expect(skill.content).toBe('Just some skill content without frontmatter.');
    });

    it('should handle empty tags array', () => {
      const content = `---
name: empty-tags
tags: []
---

Content`;

      const skill = parseSkillFile(content, 'test.md');
      expect(skill.tags).toEqual([]);
    });
  });

  describe('parseFrontmatter', () => {
    it('should parse all supported fields', () => {
      const raw = `name: my-skill
description: A test skill
version: 2
tags: [tag1, tag2, tag3]`;

      const result = parseFrontmatter(raw);

      expect(result.name).toBe('my-skill');
      expect(result.description).toBe('A test skill');
      expect(result.version).toBe(2);
      expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle missing fields', () => {
      const raw = `name: minimal`;
      const result = parseFrontmatter(raw);

      expect(result.name).toBe('minimal');
      expect(result.description).toBeUndefined();
      expect(result.version).toBeUndefined();
      expect(result.tags).toBeUndefined();
    });
  });

  describe('load', () => {
    it('should load a skill from file', async () => {
      // Create a test skill file
      const skillContent = `---
name: test-skill
description: A test skill for unit tests
---

This is the test skill content.`;

      await writeFile(join(TEST_DIR, 'test-skill.md'), skillContent);

      const service = createSkillService(TEST_DIR);
      const skill = await service.load('test-skill');

      expect(skill.name).toBe('test-skill');
      expect(skill.description).toBe('A test skill for unit tests');
      expect(skill.content).toBe('This is the test skill content.');
      expect(skill.loadedAt).toBeDefined();
    });

    it('should cache loaded skills', async () => {
      const skillContent = `---
name: cached-skill
---
Content`;

      await writeFile(join(TEST_DIR, 'cached-skill.md'), skillContent);

      const service = createSkillService(TEST_DIR);

      const skill1 = await service.load('cached-skill');
      const skill2 = await service.load('cached-skill');

      expect(skill1).toBe(skill2); // Same reference
    });

    it('should throw for non-existent skill', async () => {
      const service = createSkillService(TEST_DIR);

      await expect(service.load('non-existent')).rejects.toThrow('Skill not found');
    });
  });

  describe('unload', () => {
    it('should unload a skill', async () => {
      const skillContent = `---
name: unload-test
---
Content`;

      await writeFile(join(TEST_DIR, 'unload-test.md'), skillContent);

      const service = createSkillService(TEST_DIR);

      await service.load('unload-test');
      expect(service.isLoaded('unload-test')).toBe(true);

      service.unload('unload-test');
      expect(service.isLoaded('unload-test')).toBe(false);
    });
  });

  describe('listAvailable', () => {
    it('should list available skills', async () => {
      await writeFile(join(TEST_DIR, 'skill-a.md'), 'Content A');
      await writeFile(join(TEST_DIR, 'skill-b.md'), 'Content B');
      await writeFile(join(TEST_DIR, 'not-a-skill.txt'), 'Not a skill');

      const service = createSkillService(TEST_DIR);
      const available = await service.listAvailable();

      expect(available).toContain('skill-a');
      expect(available).toContain('skill-b');
      expect(available).not.toContain('not-a-skill');
    });

    it('should return empty array for non-existent directory', async () => {
      const service = createSkillService('/non/existent/path');
      const available = await service.listAvailable();

      expect(available).toEqual([]);
    });
  });

  describe('getLoaded', () => {
    it('should return all loaded skills', async () => {
      await writeFile(join(TEST_DIR, 'multi-a.md'), '---\nname: multi-a\n---\nA');
      await writeFile(join(TEST_DIR, 'multi-b.md'), '---\nname: multi-b\n---\nB');

      const service = createSkillService(TEST_DIR);

      await service.load('multi-a');
      await service.load('multi-b');

      const loaded = service.getLoaded();
      expect(loaded).toHaveLength(2);
      expect(loaded.map((s) => s.name)).toContain('multi-a');
      expect(loaded.map((s) => s.name)).toContain('multi-b');
    });
  });

  describe('getInjection', () => {
    it('should return empty string when no skills loaded', () => {
      const service = createSkillService(TEST_DIR);
      expect(service.getInjection()).toBe('');
    });

    it('should format loaded skills as XML injection', async () => {
      await writeFile(
        join(TEST_DIR, 'inject-test.md'),
        '---\nname: inject-test\ndescription: Test injection\n---\nSkill content here'
      );

      const service = createSkillService(TEST_DIR);
      await service.load('inject-test');

      const injection = service.getInjection();

      expect(injection).toContain('<loaded-skills>');
      expect(injection).toContain('</loaded-skills>');
      expect(injection).toContain('<skill name="inject-test" description="Test injection">');
      expect(injection).toContain('Skill content here');
      expect(injection).toContain('</skill>');
    });

    it('should include multiple skills', async () => {
      await writeFile(join(TEST_DIR, 'inj-a.md'), '---\nname: inj-a\n---\nContent A');
      await writeFile(join(TEST_DIR, 'inj-b.md'), '---\nname: inj-b\n---\nContent B');

      const service = createSkillService(TEST_DIR);
      await service.load('inj-a');
      await service.load('inj-b');

      const injection = service.getInjection();

      expect(injection).toContain('name="inj-a"');
      expect(injection).toContain('name="inj-b"');
      expect(injection).toContain('Content A');
      expect(injection).toContain('Content B');
    });
  });
});
