/**
 * Orchestrator Service Tests
 *
 * Tests for profile routing and management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getOrchestratorService,
  resetOrchestratorService,
  routePrompt,
  CODER_PROFILE,
  PLANNER_PROFILE,
  ADVISOR_PROFILE,
} from './orchestrator';

describe('OrchestratorService', () => {
  beforeEach(() => {
    resetOrchestratorService();
  });

  afterEach(() => {
    resetOrchestratorService();
  });

  describe('profile management', () => {
    it('should start with coder profile', () => {
      const service = getOrchestratorService();
      const profile = service.getCurrentProfile();
      expect(profile.id).toBe('coder');
    });

    it('should list all built-in profiles', () => {
      const service = getOrchestratorService();
      const profiles = service.listProfiles();
      expect(profiles).toHaveLength(3);
      expect(profiles.map((p) => p.id)).toEqual(['coder', 'planner', 'advisor']);
    });

    it('should switch profiles', async () => {
      const service = getOrchestratorService();

      await service.switchProfile('advisor');
      expect(service.getCurrentProfile().id).toBe('advisor');

      await service.switchProfile('planner');
      expect(service.getCurrentProfile().id).toBe('planner');

      await service.switchProfile('coder');
      expect(service.getCurrentProfile().id).toBe('coder');
    });

    it('should throw when switching to unknown profile', async () => {
      const service = getOrchestratorService();
      await expect(service.switchProfile('unknown')).rejects.toThrow('Profile not found');
    });

    it('should allow registering custom profiles', () => {
      const service = getOrchestratorService();
      const customProfile = {
        id: 'custom',
        name: 'Custom Profile',
        description: 'A custom profile',
        systemPrompt: 'You are custom.',
      };

      service.registerProfile(customProfile);
      const profiles = service.listProfiles();
      expect(profiles).toHaveLength(4);
      expect(profiles.map((p) => p.id)).toContain('custom');
    });

    it('should prevent duplicate profile registration', () => {
      const service = getOrchestratorService();
      expect(() => service.registerProfile(CODER_PROFILE)).toThrow('already exists');
    });

    it('should prevent unregistering built-in profiles', () => {
      const service = getOrchestratorService();
      expect(() => service.unregisterProfile('coder')).toThrow('built-in');
      expect(() => service.unregisterProfile('planner')).toThrow('built-in');
      expect(() => service.unregisterProfile('advisor')).toThrow('built-in');
    });

    it('should unregister custom profiles', async () => {
      const service = getOrchestratorService();
      const customProfile = {
        id: 'custom',
        name: 'Custom',
        description: 'Custom',
        systemPrompt: 'Custom',
      };

      service.registerProfile(customProfile);
      await service.switchProfile('custom');
      expect(service.getCurrentProfile().id).toBe('custom');

      service.unregisterProfile('custom');
      expect(service.listProfiles()).toHaveLength(3);
      // Should fall back to coder
      expect(service.getCurrentProfile().id).toBe('coder');
    });
  });

  describe('routing', () => {
    it('should default to coder for action prompts', () => {
      const result = routePrompt('implement a new feature');
      expect(result.profileId).toBe('coder');
      expect(result.confidence).toBe('low');
    });

    it('should route /explain to advisor', () => {
      const result = routePrompt('/explain how authentication works');
      expect(result.profileId).toBe('advisor');
      expect(result.confidence).toBe('explicit');
      expect(result.reason).toBe('/explain command');
    });

    it('should route /plan to planner', () => {
      const result = routePrompt('/plan the database migration');
      expect(result.profileId).toBe('planner');
      expect(result.confidence).toBe('explicit');
      expect(result.reason).toBe('/plan command');
    });

    it('should route "explain" questions to advisor', () => {
      const result = routePrompt('explain the authentication flow');
      expect(result.profileId).toBe('advisor');
      expect(result.confidence).toBe('high');
    });

    it('should route "what is" questions to advisor', () => {
      const result = routePrompt('what is the purpose of this function?');
      expect(result.profileId).toBe('advisor');
      expect(result.confidence).toBe('high');
    });

    it('should route "how does" questions to advisor', () => {
      const result = routePrompt('how does the caching system work?');
      expect(result.profileId).toBe('advisor');
      expect(result.confidence).toBe('high');
    });

    it('should route "plan" requests to planner', () => {
      const result = routePrompt('plan the implementation of user profiles');
      expect(result.profileId).toBe('planner');
      expect(result.confidence).toBe('high');
    });

    it('should route "design" requests to planner', () => {
      const result = routePrompt('design the API architecture');
      expect(result.profileId).toBe('planner');
      expect(result.confidence).toBe('high');
    });

    it('should route "how should I" to planner', () => {
      const result = routePrompt('how should I structure this module?');
      expect(result.profileId).toBe('planner');
      expect(result.confidence).toBe('high');
    });

    it('should route to coder when action words are present', () => {
      // Even though it starts with "explain", it wants action
      const result = routePrompt('explain and fix the bug');
      expect(result.profileId).toBe('coder');
      expect(result.confidence).toBe('low');
    });

    it('should respect user override', () => {
      const result = routePrompt('what is this?', 'coder');
      expect(result.profileId).toBe('coder');
      expect(result.confidence).toBe('explicit');
      expect(result.reason).toBe('User override');
    });

    it('should auto-switch profile on high confidence routing', async () => {
      const service = getOrchestratorService();
      expect(service.getCurrentProfile().id).toBe('coder');

      await service.route('explain the code structure');
      expect(service.getCurrentProfile().id).toBe('advisor');
    });

    it('should not auto-switch on low confidence routing', async () => {
      const service = getOrchestratorService();
      await service.switchProfile('advisor');
      expect(service.getCurrentProfile().id).toBe('advisor');

      // This routes to coder but with low confidence
      await service.route('do something');
      // Should not have switched because confidence is low
      expect(service.getCurrentProfile().id).toBe('advisor');
    });
  });

  describe('profile content', () => {
    it('coder profile should have write tools', () => {
      expect(CODER_PROFILE.tools).toContain('Write');
      expect(CODER_PROFILE.tools).toContain('Edit');
      expect(CODER_PROFILE.tools).toContain('Bash');
    });

    it('planner profile should only have read tools', () => {
      expect(PLANNER_PROFILE.tools).toContain('Read');
      expect(PLANNER_PROFILE.tools).toContain('Glob');
      expect(PLANNER_PROFILE.tools).not.toContain('Write');
      expect(PLANNER_PROFILE.tools).not.toContain('Edit');
    });

    it('advisor profile should only have read tools', () => {
      expect(ADVISOR_PROFILE.tools).toContain('Read');
      expect(ADVISOR_PROFILE.tools).toContain('Grep');
      expect(ADVISOR_PROFILE.tools).not.toContain('Write');
      expect(ADVISOR_PROFILE.tools).not.toContain('Bash');
    });
  });
});
