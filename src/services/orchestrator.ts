/**
 * OrchestratorService - Agent profile routing
 *
 * Provides:
 * - Multiple agent profiles (coder, planner, advisor)
 * - Intelligent routing based on prompt analysis
 * - Profile switching and management
 * - Event emission for profile changes
 */

import type {
  OrchestratorService,
  AgentProfile,
  RoutingDecision,
} from './types';
import { getEventBus } from '@/shared/event-bus';

// =============================================================================
// Profile Definitions
// =============================================================================

const CODER_PROFILE: AgentProfile = {
  id: 'coder',
  name: 'Coder',
  description: 'Execute tasks step by step. Write code. Run commands.',
  systemPrompt: `You are an expert software engineer. Your role is to:
- Execute coding tasks step by step
- Write clean, well-tested code
- Run commands to build, test, and verify changes
- Make changes incrementally and verify each step

Always use tools to read files before modifying them. When writing code:
- Follow existing patterns in the codebase
- Add appropriate error handling
- Include comments for complex logic
- Run tests after making changes`,
  tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch'],
  maxTokens: 4096,
};

const PLANNER_PROFILE: AgentProfile = {
  id: 'planner',
  name: 'Planner',
  description: 'Create detailed implementation plans without writing code directly.',
  systemPrompt: `You are a software architect. Your role is to:
- Analyze requirements and break them into tasks
- Create detailed implementation plans
- Identify dependencies and risks
- Suggest approaches without implementing directly

DO NOT write code directly. Instead:
- Read existing code to understand patterns
- Document the steps needed to implement
- Identify files that need to be created or modified
- Estimate complexity and suggest an order of operations`,
  tools: ['Read', 'Glob', 'Grep'],
  maxTokens: 4096,
};

const ADVISOR_PROFILE: AgentProfile = {
  id: 'advisor',
  name: 'Advisor',
  description: 'Explain concepts and answer questions without modifying files.',
  systemPrompt: `You are a knowledgeable technical advisor. Your role is to:
- Explain programming concepts clearly
- Answer questions about the codebase
- Provide guidance on best practices
- Help debug issues by analyzing code

DO NOT modify any files. Instead:
- Read code to understand the current state
- Explain how things work
- Suggest approaches for the user to implement
- Point to relevant documentation or examples`,
  tools: ['Read', 'Glob', 'Grep'],
  maxTokens: 4096,
};

const PROFILES: AgentProfile[] = [CODER_PROFILE, PLANNER_PROFILE, ADVISOR_PROFILE];

// =============================================================================
// Routing Logic
// =============================================================================

export type RoutingConfidence = 'explicit' | 'high' | 'low';

export interface DetailedRoutingDecision {
  profileId: string;
  confidence: RoutingConfidence;
  reason: string;
}

/**
 * Route a prompt to the appropriate profile based on patterns.
 *
 * Precedence:
 * 1. User override (via /agent <profile> or prefix)
 * 2. Explicit command prefix (/explain, /plan)
 * 3. Question patterns → advisor
 * 4. Planning patterns → planner
 * 5. Default → coder
 */
export function routePrompt(prompt: string, userOverride?: string): DetailedRoutingDecision {
  // 1. User override always wins
  if (userOverride) {
    const validProfiles = PROFILES.map((p) => p.id);
    if (validProfiles.includes(userOverride)) {
      return {
        profileId: userOverride,
        confidence: 'explicit',
        reason: 'User override',
      };
    }
  }

  const lower = prompt.toLowerCase().trim();

  // 2. Explicit command prefix (highest precedence)
  if (lower.startsWith('/explain ')) {
    return {
      profileId: 'advisor',
      confidence: 'explicit',
      reason: '/explain command',
    };
  }
  if (lower.startsWith('/plan ')) {
    return {
      profileId: 'planner',
      confidence: 'explicit',
      reason: '/plan command',
    };
  }

  // 3. Question patterns → advisor (but guard against false positives)
  const pureExplanation = /^(explain|what is|how does|why does|what are)\b/.test(lower);
  const wantsAction = /\b(fix|change|update|add|remove|help me|implement|create|delete|modify)\b/.test(lower);

  if (pureExplanation && !wantsAction) {
    return {
      profileId: 'advisor',
      confidence: 'high',
      reason: 'Explanation question',
    };
  }

  // 4. Planning patterns → planner
  const planningPatterns = /^(plan|design|architect|outline|how should (i|we))\b/.test(lower);
  if (planningPatterns && !wantsAction) {
    return {
      profileId: 'planner',
      confidence: 'high',
      reason: 'Planning request',
    };
  }

  // 5. Default to coder
  return {
    profileId: 'coder',
    confidence: 'low',
    reason: 'Default',
  };
}

// =============================================================================
// Service Implementation
// =============================================================================

class OrchestratorServiceImpl implements OrchestratorService {
  private profiles = new Map<string, AgentProfile>();
  private currentProfileId = 'coder';

  constructor() {
    // Register built-in profiles
    for (const profile of PROFILES) {
      this.profiles.set(profile.id, profile);
    }
  }

  getCurrentProfile(): AgentProfile {
    return this.profiles.get(this.currentProfileId) ?? CODER_PROFILE;
  }

  async switchProfile(profileId: string): Promise<void> {
    if (!this.profiles.has(profileId)) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    this.currentProfileId = profileId;

    // Emit profile change event
    const bus = getEventBus();
    bus.emit({
      type: 'SessionChange',
      sessionId: `profile:${profileId}`,
      action: 'resumed',
      timestamp: Date.now(),
    });
  }

  async route(prompt: string, userOverride?: string): Promise<RoutingDecision> {
    const decision = routePrompt(prompt, userOverride);

    // Auto-switch if high confidence or explicit
    if (decision.confidence === 'explicit' || decision.confidence === 'high') {
      await this.switchProfile(decision.profileId);
    }

    return {
      profileId: decision.profileId,
      confidence: typeof decision.confidence === 'string' ? 1.0 : decision.confidence,
      reason: decision.reason,
    };
  }

  listProfiles(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  registerProfile(profile: AgentProfile): void {
    if (this.profiles.has(profile.id)) {
      throw new Error(`Profile already exists: ${profile.id}`);
    }
    this.profiles.set(profile.id, profile);
  }

  unregisterProfile(profileId: string): void {
    // Protect built-in profiles
    const builtIn = ['coder', 'planner', 'advisor'];
    if (builtIn.includes(profileId)) {
      throw new Error(`Cannot unregister built-in profile: ${profileId}`);
    }

    this.profiles.delete(profileId);

    if (this.currentProfileId === profileId) {
      this.currentProfileId = 'coder';
    }
  }

  dispose(): void {
    this.profiles.clear();
    for (const profile of PROFILES) {
      this.profiles.set(profile.id, profile);
    }
    this.currentProfileId = 'coder';
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: OrchestratorService | null = null;

export function getOrchestratorService(): OrchestratorService {
  return (_instance ??= new OrchestratorServiceImpl());
}

export function resetOrchestratorService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

// Export profile constants for external use
export { CODER_PROFILE, PLANNER_PROFILE, ADVISOR_PROFILE, PROFILES };
