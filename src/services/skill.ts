/**
 * SkillService - Skill injection system
 *
 * Provides:
 * - Dynamic skill loading/unloading from ~/.workforce/skills/
 * - Skill discovery and validation
 * - Prompt injection for loaded skills
 * - Markdown frontmatter parsing
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { SkillService, Skill } from './types';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const SKILLS_DIR = join(getDataDir(), 'skills');
const SKILL_EXTENSION = '.md';

// =============================================================================
// Skill Parsing
// =============================================================================

interface SkillFrontmatter {
  name: string;
  description?: string;
  version?: number;
  tags?: string[];
}

/**
 * Parse skill markdown file with YAML-like frontmatter.
 *
 * Format:
 * ```
 * ---
 * name: skill-name
 * description: Skill description
 * version: 1
 * tags: [tag1, tag2]
 * ---
 *
 * Skill content goes here...
 * ```
 */
function parseSkillFile(content: string, filename: string): Skill {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // No frontmatter - use filename as name
    return {
      name: filename.replace(SKILL_EXTENSION, ''),
      description: '',
      content: content.trim(),
    };
  }

  const [, frontmatterRaw, body] = frontmatterMatch;
  const frontmatter = parseFrontmatter(frontmatterRaw);

  return {
    name: frontmatter.name || filename.replace(SKILL_EXTENSION, ''),
    description: frontmatter.description || '',
    content: body.trim(),
    tags: frontmatter.tags,
  };
}

/**
 * Simple YAML-like frontmatter parser.
 * Supports: name, description, version, tags (as array)
 */
function parseFrontmatter(raw: string): SkillFrontmatter {
  const result: SkillFrontmatter = { name: '' };
  const lines = raw.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    switch (key) {
      case 'name':
        result.name = value.trim();
        break;
      case 'description':
        result.description = value.trim();
        break;
      case 'version':
        result.version = parseInt(value.trim(), 10);
        break;
      case 'tags':
        // Parse [tag1, tag2, tag3] format
        const tagsMatch = value.match(/\[(.*)\]/);
        if (tagsMatch) {
          result.tags = tagsMatch[1]
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        }
        break;
    }
  }

  return result;
}

// =============================================================================
// Service Implementation
// =============================================================================

class SkillServiceImpl implements SkillService {
  private loadedSkills = new Map<string, Skill>();
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? SKILLS_DIR;
  }

  async load(name: string): Promise<Skill> {
    // Return cached if already loaded
    if (this.loadedSkills.has(name)) {
      return this.loadedSkills.get(name)!;
    }

    // Try to load from filesystem
    const filePath = join(this.skillsDir, `${name}${SKILL_EXTENSION}`);

    try {
      const content = await readFile(filePath, 'utf-8');
      const skill = parseSkillFile(content, `${name}${SKILL_EXTENSION}`);
      skill.loadedAt = Date.now();

      this.loadedSkills.set(name, skill);
      return skill;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        throw new Error(`Skill not found: ${name}`);
      }
      throw new Error(`Failed to load skill ${name}: ${error.message}`);
    }
  }

  unload(name: string): void {
    this.loadedSkills.delete(name);
  }

  getLoaded(): Skill[] {
    return Array.from(this.loadedSkills.values());
  }

  isLoaded(name: string): boolean {
    return this.loadedSkills.has(name);
  }

  async listAvailable(): Promise<string[]> {
    try {
      const entries = await readdir(this.skillsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(SKILL_EXTENSION))
        .map((entry) => entry.name.replace(SKILL_EXTENSION, ''));
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        // Skills directory doesn't exist yet
        return [];
      }
      throw new Error(`Failed to list skills: ${error.message}`);
    }
  }

  /**
   * Get the combined prompt injection for all loaded skills.
   *
   * Format:
   * <loaded-skills>
   *   <skill name="skill1">
   *     Skill content...
   *   </skill>
   *   ...
   * </loaded-skills>
   */
  getInjection(): string {
    const skills = this.getLoaded();
    if (skills.length === 0) {
      return '';
    }

    const sections = skills.map(
      (s) => `<skill name="${s.name}"${s.description ? ` description="${s.description}"` : ''}>\n${s.content}\n</skill>`
    );

    return `<loaded-skills>\n${sections.join('\n\n')}\n</loaded-skills>`;
  }

  /**
   * Load multiple skills at once.
   */
  async loadMultiple(names: string[]): Promise<Skill[]> {
    return Promise.all(names.map((name) => this.load(name)));
  }

  /**
   * Unload all skills.
   */
  unloadAll(): void {
    this.loadedSkills.clear();
  }

  /**
   * Check if a skill file exists.
   */
  async exists(name: string): Promise<boolean> {
    const filePath = join(this.skillsDir, `${name}${SKILL_EXTENSION}`);
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.loadedSkills.clear();
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: SkillServiceImpl | null = null;

export function getSkillService(): SkillService {
  return (_instance ??= new SkillServiceImpl());
}

export function resetSkillService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create a skill service with a custom skills directory.
 * Useful for testing.
 */
export function createSkillService(skillsDir: string): SkillService {
  return new SkillServiceImpl(skillsDir);
}

// Export types and helpers
export { parseSkillFile, parseFrontmatter };
