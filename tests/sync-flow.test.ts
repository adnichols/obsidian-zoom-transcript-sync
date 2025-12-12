/**
 * Integration tests for full sync flow with mock Vault and mock HTTP.
 * Tests subtasks 21.2, 21.3, and 21.5 from the specification.
 *
 * 21.2 - Full sync flow
 * 21.3 - Various transcript sizes
 * 21.5 - Error recovery scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockVault, Notice } from './mocks/obsidian';
import { mockRequestUrl, mockResponses } from './mocks/requestUrl';
import { ZoomRecording, ZoomListRecordingsResponse, ZoomSyncSettings } from '../src/types';
import { Vault } from 'obsidian';

// We need to test the sync flow as implemented in main.ts
// Since main.ts exports a class that extends Plugin, we'll test the core components directly
import { ZoomApiClient } from '../src/zoom-api';
import { SyncStateManager } from '../src/sync-state';
import { TranscriptWriter } from '../src/transcript-writer';

// Mock the obsidian module's requestUrl
vi.mock('obsidian', async () => {
  const obsidianMocks = await import('./mocks/obsidian');
  const requestUrlMocks = await import('./mocks/requestUrl');
  return {
    ...obsidianMocks,
    requestUrl: requestUrlMocks.mockRequestUrl.createMockFunction(),
  };
});

/**
 * Helper function to create a mock Zoom recording with transcript.
 */
function createMockRecording(overrides: Partial<ZoomRecording> = {}): ZoomRecording {
  const id = overrides.id ?? Math.floor(Math.random() * 1000000000);
  return {
    uuid: overrides.uuid ?? `uuid-${id}`,
    id: id,
    account_id: overrides.account_id ?? 'test-account',
    host_id: overrides.host_id ?? 'host-123',
    topic: overrides.topic ?? `Test Meeting ${id}`,
    type: overrides.type ?? 2,
    start_time: overrides.start_time ?? '2025-01-15T10:00:00Z',
    duration: overrides.duration ?? 60,
    total_size: overrides.total_size ?? 1000000,
    recording_count: overrides.recording_count ?? 2,
    recording_files: overrides.recording_files ?? [
      {
        id: `file-${id}-1`,
        meeting_id: String(id),
        recording_start: '2025-01-15T10:00:00Z',
        recording_end: '2025-01-15T11:00:00Z',
        file_type: 'MP4',
        file_extension: 'mp4',
        file_size: 500000,
        play_url: `https://zoom.us/play/${id}`,
        download_url: `https://zoom.us/download/${id}/video.mp4`,
        status: 'completed',
        recording_type: 'shared_screen_with_speaker_view',
      },
      {
        id: `file-${id}-2`,
        meeting_id: String(id),
        recording_start: '2025-01-15T10:00:00Z',
        recording_end: '2025-01-15T11:00:00Z',
        file_type: 'VTT',
        file_extension: 'vtt',
        file_size: 5000,
        play_url: '',
        download_url: `https://zoom.us/download/${id}/transcript.vtt`,
        status: 'completed',
        recording_type: 'audio_transcript',
      },
    ],
    participant_audio_files: overrides.participant_audio_files,
  };
}

/**
 * Helper function to create a mock recordings list response.
 */
function createMockListResponse(
  meetings: ZoomRecording[],
  nextPageToken: string = ''
): ZoomListRecordingsResponse {
  return {
    from: '2025-01-01',
    to: '2025-01-31',
    page_size: 30,
    total_records: meetings.length,
    next_page_token: nextPageToken,
    meetings: meetings,
  };
}

/**
 * Helper to generate VTT content with a specified number of entries.
 */
function generateVttContent(entryCount: number): string {
  let vtt = 'WEBVTT\n\n';
  for (let i = 0; i < entryCount; i++) {
    const startSeconds = i * 5;
    const endSeconds = startSeconds + 4;
    const startTime = formatVttTime(startSeconds);
    const endTime = formatVttTime(endSeconds);
    vtt += `${i + 1}\n`;
    vtt += `${startTime} --> ${endTime}\n`;
    vtt += `Speaker ${(i % 3) + 1}: This is line number ${i + 1} of the transcript.\n\n`;
  }
  return vtt;
}

function formatVttTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.000`;
}

/**
 * Simulates the sync flow logic from main.ts.
 * This is a simplified version that tests the component interactions.
 */
async function runSyncFlow(
  vault: MockVault,
  settings: ZoomSyncSettings,
  options: {
    onAuthError?: () => void;
    onRateLimitError?: () => void;
  } = {}
): Promise<{ syncedCount: number; skippedCount: number; failedCount: number }> {
  const apiClient = new ZoomApiClient(settings);
  const stateManager = new SyncStateManager(vault as unknown as Vault, settings.transcriptFolder);

  await stateManager.readState();

  let recordings: ZoomRecording[];
  try {
    recordings = await apiClient.listRecordings();
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('401') || message.includes('403') || message.includes('unauthorized')) {
        options.onAuthError?.();
        return { syncedCount: 0, skippedCount: 0, failedCount: 0 };
      }
      if (message.includes('429') || message.includes('rate')) {
        options.onRateLimitError?.();
        return { syncedCount: 0, skippedCount: 0, failedCount: 0 };
      }
    }
    throw error;
  }

  let syncedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const recording of recordings) {
    const meetingId = String(recording.id);

    if (stateManager.isSynced(meetingId)) {
      skippedCount++;
      continue;
    }

    const transcriptFile = recording.recording_files?.find(
      (file) => file.recording_type === 'audio_transcript'
    );

    if (!transcriptFile || !transcriptFile.download_url) {
      continue;
    }

    try {
      let vttContent: string;
      try {
        vttContent = await apiClient.downloadTranscript(transcriptFile.download_url);
      } catch (error) {
        if (error instanceof Error) {
          const message = error.message.toLowerCase();
          if (message.includes('401') || message.includes('403') || message.includes('unauthorized')) {
            options.onAuthError?.();
            return { syncedCount, skippedCount, failedCount };
          }
          if (message.includes('429') || message.includes('rate')) {
            options.onRateLimitError?.();
            return { syncedCount, skippedCount, failedCount };
          }
        }
        throw error;
      }

      const attendees: string[] = [];
      if (recording.participant_audio_files) {
        for (const audioFile of recording.participant_audio_files) {
          if (audioFile.file_name) {
            const match = audioFile.file_name.match(/^(.+?)'s audio\./i);
            if (match && match[1]) {
              attendees.push(match[1].trim());
            }
          }
        }
      }

      const writer = new TranscriptWriter(recording);
      let fileName = writer.generateFileName();

      if (TranscriptWriter.fileExists(vault as unknown as Vault, settings.transcriptFolder, fileName)) {
        fileName = writer.generateFileName(true);
      }

      const content = writer.generateTranscript(vttContent, attendees);

      await TranscriptWriter.writeToVault(
        vault as unknown as Vault,
        settings.transcriptFolder,
        fileName,
        content
      );

      stateManager.markSynced(meetingId, fileName);
      await stateManager.writeState();

      syncedCount++;
    } catch (error) {
      failedCount++;
    }
  }

  return { syncedCount, skippedCount, failedCount };
}

describe('Sync Flow Integration Tests', () => {
  let mockVault: MockVault;
  const testSettings: ZoomSyncSettings = {
    accountId: 'test-account-id',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    transcriptFolder: 'zoom-transcripts',
    syncIntervalMinutes: 30,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00.000Z'));

    // Clear mocks
    mockRequestUrl.clear();
    Notice.clear();

    // Create fresh vault for each test
    mockVault = new MockVault();

    // Setup OAuth token response
    mockRequestUrl.setResponse(
      'https://zoom.us/oauth/token',
      mockResponses.oauthToken('test-access-token', 3600)
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================================
  // 21.2 - Full sync flow
  // ============================================================================
  describe('21.2 - Full sync flow', () => {
    it('creates transcript files in correct folder', async () => {
      const recording = createMockRecording({
        id: 123456789,
        topic: 'Team Standup',
      });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording]))
      );

      mockRequestUrl.setResponse(
        'https://zoom.us/download/123456789/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nSpeaker: Hello')
      );

      await runSyncFlow(mockVault, testSettings);

      // Check file was created in correct folder
      const filePath = 'zoom-transcripts/Team Standup.md';
      expect(mockVault.getAbstractFileByPath(filePath)).not.toBeNull();
    });

    it('writes correct frontmatter and content', async () => {
      const recording = createMockRecording({
        id: 111222333,
        topic: 'Weekly Planning',
        start_time: '2025-01-15T14:00:00Z',
        duration: 45,
        participant_audio_files: [
          {
            id: 'audio-1',
            recording_start: '2025-01-15T14:00:00Z',
            recording_end: '2025-01-15T14:45:00Z',
            file_name: "John Doe's audio.m4a",
            file_type: 'M4A',
            file_extension: 'm4a',
            file_size: 10000,
            download_url: 'https://zoom.us/download/audio1',
            status: 'completed',
          },
          {
            id: 'audio-2',
            recording_start: '2025-01-15T14:00:00Z',
            recording_end: '2025-01-15T14:45:00Z',
            file_name: "Jane Smith's audio.m4a",
            file_type: 'M4A',
            file_extension: 'm4a',
            file_size: 10000,
            download_url: 'https://zoom.us/download/audio2',
            status: 'completed',
          },
        ],
      });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording]))
      );

      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
John Doe: Good morning everyone.

2
00:00:12.000 --> 00:00:18.000
Jane Smith: Good morning, let's get started.`;

      mockRequestUrl.setResponse(
        'https://zoom.us/download/111222333/transcript.vtt',
        mockResponses.text(vttContent)
      );

      await runSyncFlow(mockVault, testSettings);

      const filePath = 'zoom-transcripts/Weekly Planning.md';
      const content = mockVault.adapter.getFile(filePath);

      expect(content).toBeDefined();

      // Check frontmatter
      expect(content).toContain('---');
      expect(content).toContain('meeting_name: "Weekly Planning"');
      expect(content).toContain('meeting_time: 2025-01-15T14:00:00Z');
      expect(content).toContain('meeting_duration: 45');
      expect(content).toContain('zoom_meeting_id: "111222333"');
      expect(content).toContain('- John Doe');
      expect(content).toContain('- Jane Smith');

      // Check transcript content
      expect(content).toContain('# Weekly Planning');
      expect(content).toContain('## Attendees');
      expect(content).toContain('## Transcript');
      expect(content).toContain('Good morning everyone');
      expect(content).toContain('Good morning, let\'s get started');
    });

    it('updates sync state after each transcript', async () => {
      const recording1 = createMockRecording({ id: 111, topic: 'Meeting One' });
      const recording2 = createMockRecording({ id: 222, topic: 'Meeting Two' });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording1, recording2]))
      );

      mockRequestUrl.setResponse(
        'https://zoom.us/download/111/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nTest content 1')
      );
      mockRequestUrl.setResponse(
        'https://zoom.us/download/222/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nTest content 2')
      );

      await runSyncFlow(mockVault, testSettings);

      // Check sync state file
      const stateContent = mockVault.adapter.getFile('zoom-transcripts/.zoom-sync-state.json');
      expect(stateContent).toBeDefined();

      const state = JSON.parse(stateContent!);
      expect(state.syncedMeetings['111']).toBeDefined();
      expect(state.syncedMeetings['222']).toBeDefined();
      expect(state.syncedMeetings['111'].fileName).toBe('Meeting One.md');
      expect(state.syncedMeetings['222'].fileName).toBe('Meeting Two.md');
    });

    it('skips already-synced meetings', async () => {
      // Pre-populate sync state
      const existingState = {
        version: 1,
        syncedMeetings: {
          '111': { syncedAt: 1705312200000, fileName: 'Existing Meeting.md' },
        },
      };
      mockVault.adapter.setFile(
        'zoom-transcripts/.zoom-sync-state.json',
        JSON.stringify(existingState)
      );

      const recording1 = createMockRecording({ id: 111, topic: 'Existing Meeting' });
      const recording2 = createMockRecording({ id: 222, topic: 'New Meeting' });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording1, recording2]))
      );

      mockRequestUrl.setResponse(
        'https://zoom.us/download/222/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nNew content')
      );

      const result = await runSyncFlow(mockVault, testSettings);

      expect(result.syncedCount).toBe(1);
      expect(result.skippedCount).toBe(1);

      // Only new meeting file should exist
      expect(mockVault.getAbstractFileByPath('zoom-transcripts/New Meeting.md')).not.toBeNull();
    });

    it('handles file collision by appending ID', async () => {
      // Create existing file with same name
      mockVault.addFile('zoom-transcripts/Duplicate Meeting.md', 'existing content');
      mockVault.addFolder('zoom-transcripts');

      const recording = createMockRecording({ id: 999888777, topic: 'Duplicate Meeting' });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording]))
      );

      mockRequestUrl.setResponse(
        'https://zoom.us/download/999888777/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nNew transcript')
      );

      await runSyncFlow(mockVault, testSettings);

      // File should have ID appended
      const fileWithId = mockVault.getAbstractFileByPath(
        'zoom-transcripts/Duplicate Meeting (999888777).md'
      );
      expect(fileWithId).not.toBeNull();

      // Check content of new file
      const content = mockVault.adapter.getFile('zoom-transcripts/Duplicate Meeting (999888777).md');
      expect(content).toContain('New transcript');
    });
  });

  // ============================================================================
  // 21.3 - Various transcript sizes
  // ============================================================================
  describe('21.3 - Various transcript sizes', () => {
    it('handles small transcript (few lines)', async () => {
      const recording = createMockRecording({ id: 100, topic: 'Small Meeting' });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording]))
      );

      // 5 lines of transcript
      const vttContent = generateVttContent(5);

      mockRequestUrl.setResponse(
        'https://zoom.us/download/100/transcript.vtt',
        mockResponses.text(vttContent)
      );

      const result = await runSyncFlow(mockVault, testSettings);

      expect(result.syncedCount).toBe(1);

      const content = mockVault.adapter.getFile('zoom-transcripts/Small Meeting.md');
      expect(content).toBeDefined();
      expect(content).toContain('This is line number 1');
      expect(content).toContain('This is line number 5');
    });

    it('handles medium transcript (100+ lines)', async () => {
      const recording = createMockRecording({ id: 200, topic: 'Medium Meeting' });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording]))
      );

      // 150 lines of transcript
      const vttContent = generateVttContent(150);

      mockRequestUrl.setResponse(
        'https://zoom.us/download/200/transcript.vtt',
        mockResponses.text(vttContent)
      );

      const result = await runSyncFlow(mockVault, testSettings);

      expect(result.syncedCount).toBe(1);

      const content = mockVault.adapter.getFile('zoom-transcripts/Medium Meeting.md');
      expect(content).toBeDefined();
      expect(content).toContain('This is line number 1');
      expect(content).toContain('This is line number 100');
      expect(content).toContain('This is line number 150');
    });

    it('handles large transcript (1000+ lines)', async () => {
      const recording = createMockRecording({ id: 300, topic: 'Large Meeting' });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording]))
      );

      // 1200 lines of transcript
      const vttContent = generateVttContent(1200);

      mockRequestUrl.setResponse(
        'https://zoom.us/download/300/transcript.vtt',
        mockResponses.text(vttContent)
      );

      const result = await runSyncFlow(mockVault, testSettings);

      expect(result.syncedCount).toBe(1);

      const content = mockVault.adapter.getFile('zoom-transcripts/Large Meeting.md');
      expect(content).toBeDefined();
      expect(content).toContain('This is line number 1');
      expect(content).toContain('This is line number 500');
      expect(content).toContain('This is line number 1000');
      expect(content).toContain('This is line number 1200');

      // Verify all speaker entries are present
      expect(content).toContain('Speaker 1:');
      expect(content).toContain('Speaker 2:');
      expect(content).toContain('Speaker 3:');
    });
  });

  // ============================================================================
  // 21.5 - Error recovery scenarios
  // ============================================================================
  describe('21.5 - Error recovery', () => {
    it('sync continues if individual transcript fails', async () => {
      const recording1 = createMockRecording({ id: 111, topic: 'Will Fail' });
      const recording2 = createMockRecording({ id: 222, topic: 'Will Succeed' });
      const recording3 = createMockRecording({ id: 333, topic: 'Also Succeeds' });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording1, recording2, recording3]))
      );

      // First transcript fails with non-retryable error (404)
      mockRequestUrl.setResponse('https://zoom.us/download/111/transcript.vtt', () => {
        throw new Error('Download failed: 404 Not Found');
      });

      // Other transcripts succeed
      mockRequestUrl.setResponse(
        'https://zoom.us/download/222/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nContent 2')
      );
      mockRequestUrl.setResponse(
        'https://zoom.us/download/333/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nContent 3')
      );

      const result = await runSyncFlow(mockVault, testSettings);

      expect(result.syncedCount).toBe(2);
      expect(result.failedCount).toBe(1);

      // Verify successful files exist
      expect(mockVault.getAbstractFileByPath('zoom-transcripts/Will Succeed.md')).not.toBeNull();
      expect(mockVault.getAbstractFileByPath('zoom-transcripts/Also Succeeds.md')).not.toBeNull();
    });

    it('returns partial success count', async () => {
      const recordings = [
        createMockRecording({ id: 1, topic: 'Success 1' }),
        createMockRecording({ id: 2, topic: 'Failure 1' }),
        createMockRecording({ id: 3, topic: 'Success 2' }),
        createMockRecording({ id: 4, topic: 'Failure 2' }),
        createMockRecording({ id: 5, topic: 'Success 3' }),
      ];

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse(recordings))
      );

      // Set up alternating success/failure with non-retryable errors (400)
      mockRequestUrl.setResponse(
        'https://zoom.us/download/1/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nSuccess')
      );
      mockRequestUrl.setResponse('https://zoom.us/download/2/transcript.vtt', () => {
        throw new Error('Bad request: 400');
      });
      mockRequestUrl.setResponse(
        'https://zoom.us/download/3/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nSuccess')
      );
      mockRequestUrl.setResponse('https://zoom.us/download/4/transcript.vtt', () => {
        throw new Error('Bad request: 400');
      });
      mockRequestUrl.setResponse(
        'https://zoom.us/download/5/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nSuccess')
      );

      const result = await runSyncFlow(mockVault, testSettings);

      expect(result.syncedCount).toBe(3);
      expect(result.failedCount).toBe(2);
    });

    it('auth error stops entire sync and triggers callback', async () => {
      const recording1 = createMockRecording({ id: 111 });
      const recording2 = createMockRecording({ id: 222 });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording1, recording2]))
      );

      // First download triggers auth error
      mockRequestUrl.setResponse('https://zoom.us/download/111/transcript.vtt', () => {
        throw new Error('Failed: 401 Unauthorized');
      });

      // Second should never be called
      mockRequestUrl.setResponse(
        'https://zoom.us/download/222/transcript.vtt',
        mockResponses.text('WEBVTT\n\nShould not reach')
      );

      let authErrorCalled = false;
      const result = await runSyncFlow(mockVault, testSettings, {
        onAuthError: () => {
          authErrorCalled = true;
        },
      });

      expect(authErrorCalled).toBe(true);
      expect(result.syncedCount).toBe(0);

      // Second file should not have been created
      expect(mockVault.getAbstractFileByPath('zoom-transcripts/Test Meeting 222.md')).toBeNull();
    });

    it('auth error on listRecordings stops sync and disables auto-sync', async () => {
      mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/me\/recordings/, () => {
        throw new Error('Failed: 401 Unauthorized');
      });

      let authErrorCalled = false;
      await runSyncFlow(mockVault, testSettings, {
        onAuthError: () => {
          authErrorCalled = true;
        },
      });

      expect(authErrorCalled).toBe(true);
    });

    it('rate limit error triggers callback', async () => {
      const recording = createMockRecording({ id: 111 });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording]))
      );

      // Download triggers rate limit - retries will exhaust
      mockRequestUrl.setResponse('https://zoom.us/download/111/transcript.vtt', () => {
        throw new Error('Rate limited: 429');
      });

      let rateLimitCalled = false;
      const resultPromise = runSyncFlow(mockVault, testSettings, {
        onRateLimitError: () => {
          rateLimitCalled = true;
        },
      });

      // Advance time for retry backoff delays (1s + 3s = 4s)
      await vi.advanceTimersByTimeAsync(4000);

      const result = await resultPromise;

      expect(rateLimitCalled).toBe(true);
      expect(result.syncedCount).toBe(0);
    });

    it('rate limit on listRecordings triggers callback', async () => {
      mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/me\/recordings/, () => {
        throw new Error('Rate limited: 429');
      });

      let rateLimitCalled = false;
      const resultPromise = runSyncFlow(mockVault, testSettings, {
        onRateLimitError: () => {
          rateLimitCalled = true;
        },
      });

      // Advance time for retry backoff delays (1s + 3s = 4s)
      await vi.advanceTimersByTimeAsync(4000);

      await resultPromise;

      expect(rateLimitCalled).toBe(true);
    });

    it('sync state is preserved on partial failure', async () => {
      const recording1 = createMockRecording({ id: 111, topic: 'First Meeting' });
      const recording2 = createMockRecording({ id: 222, topic: 'Second Meeting' });
      const recording3 = createMockRecording({ id: 333, topic: 'Third Meeting' });

      mockRequestUrl.setPatternResponse(
        /api\.zoom\.us\/v2\/users\/me\/recordings/,
        mockResponses.json(createMockListResponse([recording1, recording2, recording3]))
      );

      // First succeeds
      mockRequestUrl.setResponse(
        'https://zoom.us/download/111/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nContent 1')
      );

      // Second fails with non-retryable error (404)
      mockRequestUrl.setResponse('https://zoom.us/download/222/transcript.vtt', () => {
        throw new Error('Not found: 404');
      });

      // Third succeeds
      mockRequestUrl.setResponse(
        'https://zoom.us/download/333/transcript.vtt',
        mockResponses.text('WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nContent 3')
      );

      await runSyncFlow(mockVault, testSettings);

      // Check sync state
      const stateContent = mockVault.adapter.getFile('zoom-transcripts/.zoom-sync-state.json');
      const state = JSON.parse(stateContent!);

      // First and third should be synced
      expect(state.syncedMeetings['111']).toBeDefined();
      expect(state.syncedMeetings['333']).toBeDefined();

      // Second should not be in sync state
      expect(state.syncedMeetings['222']).toBeUndefined();
    });
  });
});
