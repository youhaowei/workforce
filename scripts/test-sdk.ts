#!/usr/bin/env tsx
/**
 * Simple hello world script to test Claude Agent SDK auth.
 *
 * Usage:
 *   tsx scripts/test-sdk.ts
 *
 * This script helps diagnose auth issues by:
 * 1. Printing environment diagnostics
 * 2. Attempting a simple SDK query
 * 3. Reporting success or detailed error info
 */

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

const home = process.env.HOME || homedir();
const credPath = `${home}/.claude/.credentials.json`;

console.log('=== Claude Agent SDK Test ===\n');

// Print diagnostics
console.log('[Diagnostics]');
console.log('  CWD:', process.cwd());
console.log('  HOME:', home);
console.log('  Credentials file exists:', existsSync(credPath));
console.log('  ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);
console.log('  ANTHROPIC_AUTH_TOKEN set:', !!process.env.ANTHROPIC_AUTH_TOKEN);
console.log('  PID:', process.pid);
console.log('  PPID:', process.ppid);
console.log('');

// Check credentials file structure
if (existsSync(credPath)) {
  try {
    const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
    console.log('[Credentials File]');
    console.log('  Has claudeAiOauth:', !!creds.claudeAiOauth);
    if (creds.claudeAiOauth) {
      console.log('  Has accessToken:', !!creds.claudeAiOauth.accessToken);
      console.log('  Has refreshToken:', !!creds.claudeAiOauth.refreshToken);
      if (creds.claudeAiOauth.expiresAt) {
        const expiresAt = new Date(creds.claudeAiOauth.expiresAt);
        console.log('  Token expires:', expiresAt.toISOString());
        console.log('  Token expired:', expiresAt < new Date());
      }
    }
    console.log('');
  } catch (err) {
    console.error('[Credentials File] Error reading:', err);
    console.log('');
  }
}

// Test SDK query
console.log('[SDK Test] Sending "Say hello in exactly 3 words"...\n');

try {
  const queryStream = sdkQuery({
    prompt: 'Say hello in exactly 3 words. Nothing else.',
    options: {
      cwd: process.cwd(),
    },
  });

  let response = '';
  let gotResponse = false;

  for await (const message of queryStream) {
    // Handle streaming text deltas (if using includePartialMessages)
    if (message.type === 'stream_event') {
      const event = message.event;
      if (event.type === 'content_block_delta' && 'delta' in event) {
        const delta = event.delta as { type: string; text?: string };
        if (delta.type === 'text_delta' && delta.text) {
          process.stdout.write(delta.text);
          response += delta.text;
          gotResponse = true;
        }
      }
    }

    // Handle final assistant message (standard response)
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text' && 'text' in block) {
          response = block.text;
          gotResponse = true;
        }
      }
    }

    // Handle result message
    if (message.type === 'result' && 'result' in message && message.result) {
      if (!response) {
        response = String(message.result);
        gotResponse = true;
      }
    }
  }

  if (gotResponse) {
    console.log('[Result] ✅ SDK query succeeded!');
    console.log('[Response]', response.trim().slice(0, 200) + (response.length > 200 ? '...' : ''));
  } else {
    console.log('[Result] ⚠️  Query completed but no text response received');
  }
} catch (err) {
  console.error('\n[Result] ❌ SDK query failed!');
  console.error('[Error]', err instanceof Error ? err.message : err);

  // Check for auth-specific errors
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (
    msg.includes('authentication') ||
    msg.includes('unauthorized') ||
    msg.includes('401') ||
    msg.includes('api key')
  ) {
    console.log('\n[Hint] This looks like an authentication error.');
    console.log('  Try running: claude login');
    console.log('  Or set ANTHROPIC_API_KEY environment variable');
  }

  process.exit(1);
}
