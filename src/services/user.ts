/**
 * UserService - User identity management and persistence
 *
 * Provides:
 * - Single-user identity (display name, avatar color)
 * - Disk persistence at ~/.workforce/user.json
 *
 * This is a single-user service (one user per installation).
 */

import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join, dirname } from "path";
import type { User, UserService } from "./types";
import { getDataDir } from "./data-dir";
import { colorFromName } from "@/shared/palette";
import { getLogService } from "./log";

// =============================================================================
// Configuration
// =============================================================================

const USER_FILE = join(getDataDir(), "user.json");

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Service Implementation
// =============================================================================

class UserServiceImpl implements UserService {
  private user: User | null = null;
  private filePath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? USER_FILE;
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    return (this.initPromise ??= this.doInit());
  }

  private async doInit(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.user = JSON.parse(raw) as User;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "ENOENT") {
        getLogService().error("general", "Failed to load user", { error: String(error) });
      }
      // No user file yet — that's fine
    }
    this.initialized = true;
  }

  private async save(): Promise<void> {
    if (!this.user) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.user, null, 2), "utf-8");
  }

  async get(): Promise<User | null> {
    await this.ensureInitialized();
    return this.user;
  }

  async create(displayName: string): Promise<User> {
    await this.ensureInitialized();

    if (this.user) {
      throw new Error("User already exists. Use update() to change the display name.");
    }

    const now = Date.now();
    this.user = {
      id: generateId(),
      displayName,
      avatarColor: colorFromName(displayName),
      createdAt: now,
      updatedAt: now,
    };

    await this.save();
    return this.user;
  }

  async update(updates: Partial<Pick<User, "displayName">>): Promise<User> {
    await this.ensureInitialized();

    if (!this.user) {
      throw new Error("No user exists. Call create() first.");
    }

    this.user = {
      ...this.user,
      ...updates,
      id: this.user.id,
      createdAt: this.user.createdAt,
      updatedAt: Date.now(),
    };

    // Recompute avatar color if display name changed
    if (updates.displayName) {
      this.user.avatarColor = colorFromName(this.user.displayName);
    }

    await this.save();
    return this.user;
  }

  async delete(): Promise<void> {
    await this.ensureInitialized();
    this.user = null;
    try {
      await unlink(this.filePath);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "ENOENT") {
        getLogService().error("general", "Failed to delete user file", { error: String(error) });
      }
    }
  }

  async exists(): Promise<boolean> {
    await this.ensureInitialized();
    return this.user !== null;
  }

  dispose(): void {
    this.user = null;
    this.initialized = false;
    this.initPromise = null;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: UserServiceImpl | null = null;

export function getUserService(): UserService {
  return (_instance ??= new UserServiceImpl());
}

export function resetUserService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create a user service with a custom file path.
 * Useful for testing.
 */
export function createUserService(filePath: string): UserService {
  return new UserServiceImpl(filePath);
}
