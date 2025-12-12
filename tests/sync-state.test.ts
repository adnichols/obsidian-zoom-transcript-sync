/**
 * Unit tests for sync state read/write operations.
 * Tests SyncStateManager class from src/sync-state.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncStateManager } from '../src/sync-state';
import { MockVault } from './mocks/obsidian';
import { Vault } from 'obsidian';

describe('SyncStateManager', () => {
  let mockVault: MockVault;
  let syncStateManager: SyncStateManager;
  const transcriptFolder = 'zoom-transcripts';

  beforeEach(() => {
    mockVault = new MockVault();
    syncStateManager = new SyncStateManager(mockVault as unknown as Vault, transcriptFolder);
  });

  describe('stateFilePath', () => {
    it('returns correct state file path', () => {
      expect(syncStateManager.stateFilePath).toBe('zoom-transcripts/.zoom-sync-state.json');
    });

    it('uses custom transcript folder in path', () => {
      const customManager = new SyncStateManager(
        mockVault as unknown as Vault,
        'custom-folder/transcripts'
      );
      expect(customManager.stateFilePath).toBe('custom-folder/transcripts/.zoom-sync-state.json');
    });
  });

  describe('readState', () => {
    it('reads state from JSON file', async () => {
      const existingState = {
        version: 1,
        syncedMeetings: {
          '123456789': {
            syncedAt: 1705312200000,
            fileName: 'Team Meeting.md',
          },
          '987654321': {
            syncedAt: 1705315800000,
            fileName: 'Planning Session.md',
          },
        },
      };

      mockVault.adapter.setFile(
        'zoom-transcripts/.zoom-sync-state.json',
        JSON.stringify(existingState)
      );

      const state = await syncStateManager.readState();

      expect(state).toEqual(existingState);
      expect(state.version).toBe(1);
      expect(state.syncedMeetings['123456789'].fileName).toBe('Team Meeting.md');
      expect(state.syncedMeetings['987654321'].fileName).toBe('Planning Session.md');
    });

    it('handles missing state file - returns default state', async () => {
      // No file set in mock adapter

      const state = await syncStateManager.readState();

      expect(state).toEqual({
        version: 1,
        syncedMeetings: {},
      });
    });

    it('handles corrupted JSON - returns default state', async () => {
      mockVault.adapter.setFile(
        'zoom-transcripts/.zoom-sync-state.json',
        'this is not valid JSON { broken'
      );

      const state = await syncStateManager.readState();

      expect(state).toEqual({
        version: 1,
        syncedMeetings: {},
      });
    });

    it('handles empty file - returns default state', async () => {
      mockVault.adapter.setFile('zoom-transcripts/.zoom-sync-state.json', '');

      const state = await syncStateManager.readState();

      expect(state).toEqual({
        version: 1,
        syncedMeetings: {},
      });
    });
  });

  describe('writeState', () => {
    it('throws error if readState was not called first', async () => {
      await expect(syncStateManager.writeState()).rejects.toThrow(
        'No state to write. Call readState() first.'
      );
    });

    it('writes state atomically using temp file then rename', async () => {
      // First read state to initialize
      await syncStateManager.readState();

      // Add a meeting
      syncStateManager.markSynced('123456789', 'Test Meeting.md');

      await syncStateManager.writeState();

      // Verify the temp file was created and renamed to actual file
      const finalContent = mockVault.adapter.getFile('zoom-transcripts/.zoom-sync-state.json');
      expect(finalContent).toBeDefined();

      const parsedContent = JSON.parse(finalContent!);
      expect(parsedContent.version).toBe(1);
      expect(parsedContent.syncedMeetings['123456789']).toBeDefined();
      expect(parsedContent.syncedMeetings['123456789'].fileName).toBe('Test Meeting.md');
    });

    it('writes JSON with proper formatting (indentation)', async () => {
      await syncStateManager.readState();
      syncStateManager.markSynced('123', 'Meeting.md');

      await syncStateManager.writeState();

      const content = mockVault.adapter.getFile('zoom-transcripts/.zoom-sync-state.json');

      // Check that content is formatted with indentation (2 spaces)
      expect(content).toContain('{\n');
      expect(content).toContain('  "version"');
    });

    it('preserves existing entries when writing', async () => {
      const existingState = {
        version: 1,
        syncedMeetings: {
          '111': { syncedAt: 1000, fileName: 'Old Meeting.md' },
        },
      };
      mockVault.adapter.setFile(
        'zoom-transcripts/.zoom-sync-state.json',
        JSON.stringify(existingState)
      );

      await syncStateManager.readState();
      syncStateManager.markSynced('222', 'New Meeting.md');
      await syncStateManager.writeState();

      const content = mockVault.adapter.getFile('zoom-transcripts/.zoom-sync-state.json');
      const parsed = JSON.parse(content!);

      expect(parsed.syncedMeetings['111']).toBeDefined();
      expect(parsed.syncedMeetings['222']).toBeDefined();
    });
  });

  describe('isSynced', () => {
    it('returns false when state has not been read', () => {
      // State not initialized
      expect(syncStateManager.isSynced('123456789')).toBe(false);
    });

    it('correctly identifies synced meetings', async () => {
      const existingState = {
        version: 1,
        syncedMeetings: {
          '123456789': {
            syncedAt: 1705312200000,
            fileName: 'Team Meeting.md',
          },
        },
      };
      mockVault.adapter.setFile(
        'zoom-transcripts/.zoom-sync-state.json',
        JSON.stringify(existingState)
      );

      await syncStateManager.readState();

      expect(syncStateManager.isSynced('123456789')).toBe(true);
    });

    it('correctly identifies unsynced meetings', async () => {
      const existingState = {
        version: 1,
        syncedMeetings: {
          '123456789': {
            syncedAt: 1705312200000,
            fileName: 'Team Meeting.md',
          },
        },
      };
      mockVault.adapter.setFile(
        'zoom-transcripts/.zoom-sync-state.json',
        JSON.stringify(existingState)
      );

      await syncStateManager.readState();

      expect(syncStateManager.isSynced('999999999')).toBe(false);
    });

    it('returns false for empty syncedMeetings', async () => {
      await syncStateManager.readState(); // Initializes with empty syncedMeetings

      expect(syncStateManager.isSynced('123456789')).toBe(false);
    });
  });

  describe('markSynced', () => {
    it('adds new entries to state when state is initialized', async () => {
      await syncStateManager.readState();

      const beforeMark = Date.now();
      syncStateManager.markSynced('123456789', 'New Meeting.md');
      const afterMark = Date.now();

      expect(syncStateManager.isSynced('123456789')).toBe(true);

      // Verify the entry was created with correct structure
      await syncStateManager.writeState();
      const content = mockVault.adapter.getFile('zoom-transcripts/.zoom-sync-state.json');
      const parsed = JSON.parse(content!);

      expect(parsed.syncedMeetings['123456789'].fileName).toBe('New Meeting.md');
      expect(parsed.syncedMeetings['123456789'].syncedAt).toBeGreaterThanOrEqual(beforeMark);
      expect(parsed.syncedMeetings['123456789'].syncedAt).toBeLessThanOrEqual(afterMark);
    });

    it('initializes state if called before readState', () => {
      // Call markSynced without calling readState first
      syncStateManager.markSynced('123456789', 'Meeting.md');

      // Should initialize state internally
      expect(syncStateManager.isSynced('123456789')).toBe(true);
    });

    it('can add multiple meetings', async () => {
      await syncStateManager.readState();

      syncStateManager.markSynced('111', 'First.md');
      syncStateManager.markSynced('222', 'Second.md');
      syncStateManager.markSynced('333', 'Third.md');

      expect(syncStateManager.isSynced('111')).toBe(true);
      expect(syncStateManager.isSynced('222')).toBe(true);
      expect(syncStateManager.isSynced('333')).toBe(true);
    });

    it('updates existing entry if marked again', async () => {
      vi.useFakeTimers();
      const firstTime = new Date('2025-01-01T10:00:00Z').getTime();
      vi.setSystemTime(firstTime);

      await syncStateManager.readState();
      syncStateManager.markSynced('123', 'First Name.md');

      // Advance time
      const secondTime = new Date('2025-01-15T10:00:00Z').getTime();
      vi.setSystemTime(secondTime);

      syncStateManager.markSynced('123', 'Updated Name.md');

      await syncStateManager.writeState();
      const content = mockVault.adapter.getFile('zoom-transcripts/.zoom-sync-state.json');
      const parsed = JSON.parse(content!);

      expect(parsed.syncedMeetings['123'].fileName).toBe('Updated Name.md');
      expect(parsed.syncedMeetings['123'].syncedAt).toBe(secondTime);

      vi.useRealTimers();
    });

    it('uses string meeting IDs consistently', async () => {
      await syncStateManager.readState();

      // Mark with string ID
      syncStateManager.markSynced('123456789', 'Meeting.md');

      // Check with same string ID
      expect(syncStateManager.isSynced('123456789')).toBe(true);

      await syncStateManager.writeState();
      const content = mockVault.adapter.getFile('zoom-transcripts/.zoom-sync-state.json');
      const parsed = JSON.parse(content!);

      // Key should be string in JSON
      expect(Object.keys(parsed.syncedMeetings)).toContain('123456789');
    });
  });
});
