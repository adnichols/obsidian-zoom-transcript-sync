/**
 * Unit tests for YAML frontmatter generation.
 * Tests TranscriptWriter.generateTranscript() and generateFileName() methods
 * from src/transcript-writer.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the obsidian module before importing transcript-writer
vi.mock('obsidian', async () => {
  const mocks = await import('./mocks/obsidian');
  return mocks;
});

import { TranscriptWriter } from '../src/transcript-writer';
import { ZoomRecording } from '../src/types';

describe('TranscriptWriter', () => {
  // Mock Date.now() for consistent synced_at timestamps
  const mockNow = new Date('2025-01-15T10:30:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateTranscript - YAML frontmatter generation', () => {
    it('generates correct YAML frontmatter with all specified fields', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Team Standup Meeting',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 45,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [
          {
            id: 'file-1',
            meeting_id: '123456789',
            recording_start: '2025-01-15T09:00:00Z',
            recording_end: '2025-01-15T09:45:00Z',
            file_type: 'MP4',
            file_extension: 'mp4',
            file_size: 500000,
            play_url: 'https://zoom.us/rec/play/abc123',
            download_url: 'https://zoom.us/rec/download/abc123',
            status: 'completed',
            recording_type: 'shared_screen_with_speaker_view',
          },
        ],
      };

      const writer = new TranscriptWriter(recording);
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
Alice: Hello team.`;
      const attendees = ['Alice', 'Bob', 'Charlie'];

      const result = writer.generateTranscript(vttContent, attendees);

      // Check frontmatter delimiters
      expect(result).toMatch(/^---\n/);
      expect(result).toMatch(/\n---\n/);

      // Check all frontmatter fields
      expect(result).toContain('meeting_name: "Team Standup Meeting"');
      expect(result).toContain('meeting_time: 2025-01-15T09:00:00Z');
      expect(result).toContain('meeting_duration: 45');
      expect(result).toContain('topic: "Team Standup Meeting"');
      expect(result).toContain('host: ""');
      expect(result).toContain('recording_url: "https://zoom.us/rec/play/abc123"');
      expect(result).toContain('zoom_meeting_id: "123456789"');
      expect(result).toContain('synced_at: 2025-01-15T10:30:00.000Z');

      // Check attendees array format
      expect(result).toContain('attendees:');
      expect(result).toContain('  - Alice');
      expect(result).toContain('  - Bob');
      expect(result).toContain('  - Charlie');
    });

    it('escapes special characters in frontmatter values - double quotes', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Meeting about "Important" topics',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const result = writer.generateTranscript('WEBVTT\n\n', []);

      expect(result).toContain('meeting_name: "Meeting about \\"Important\\" topics"');
      expect(result).toContain('topic: "Meeting about \\"Important\\" topics"');
    });

    it('escapes special characters in frontmatter values - backslashes', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Path C:\\Users\\Documents',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const result = writer.generateTranscript('WEBVTT\n\n', []);

      // Backslashes should be escaped in YAML
      expect(result).toContain('meeting_name: "Path C:\\\\Users\\\\Documents"');
    });

    it('escapes special characters in attendee names', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Test Meeting',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const attendees = ['John "Johnny" Smith', 'Jane O\'Connor'];
      const result = writer.generateTranscript('WEBVTT\n\n', attendees);

      expect(result).toContain('  - John \\"Johnny\\" Smith');
    });

    it('handles missing optional fields - empty topic', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: '',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const result = writer.generateTranscript('WEBVTT\n\n', []);

      expect(result).toContain('meeting_name: ""');
      expect(result).toContain('topic: ""');
    });

    it('handles missing optional fields - no attendees', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Test Meeting',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const result = writer.generateTranscript('WEBVTT\n\n', []);

      expect(result).toContain('attendees:');
      // No attendee entries should follow
      const frontmatterEnd = result.indexOf('---', 4);
      const attendeesSection = result.slice(
        result.indexOf('attendees:'),
        result.indexOf('topic:', result.indexOf('attendees:'))
      );
      expect(attendeesSection.match(/^\s+-/gm)).toBeNull();
    });

    it('handles missing recording_files - empty recording_url', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Test Meeting',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 0,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const result = writer.generateTranscript('WEBVTT\n\n', []);

      expect(result).toContain('recording_url: ""');
    });

    it('verifies frontmatter delimiter format (--- ... ---)', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Test',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const result = writer.generateTranscript('WEBVTT\n\n', []);

      // Check exact format: starts with --- and has closing ---
      expect(result.startsWith('---\n')).toBe(true);

      // Find the closing delimiter
      const firstDelim = result.indexOf('---');
      const secondDelim = result.indexOf('---', firstDelim + 3);
      expect(secondDelim).toBeGreaterThan(firstDelim);

      // Ensure the closing delimiter is on its own line
      expect(result[secondDelim - 1]).toBe('\n');
    });
  });

  describe('generateFileName - file name sanitization', () => {
    it('generates filename from meeting topic', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Team Standup Meeting',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName();

      expect(fileName).toBe('Team Standup Meeting.md');
    });

    it('replaces colon with dash for readability', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Q4 Planning: What Next?',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName();

      expect(fileName).toBe('Q4 Planning - What Next.md');
    });

    it('removes unsafe filesystem characters', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Meeting: Test/Review\\Final*Draft?v1"2<3>4|5',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName();

      // Should not contain: / \ * ? " < > |
      expect(fileName).not.toMatch(/[\/\\*?"<>|]/);
      expect(fileName).toBe('Meeting - TestReviewFinalDraftv12345.md');
    });

    it('removes single quotes', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: "What's Next? Q4",
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName();

      expect(fileName).toBe('Whats Next Q4.md');
    });

    it('collapses multiple spaces into single space', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Team   Meeting   Notes',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName();

      expect(fileName).toBe('Team Meeting Notes.md');
    });

    it('trims leading and trailing whitespace', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: '  Spaced Meeting  ',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName();

      expect(fileName).toBe('Spaced Meeting.md');
    });

    it('handles empty topic - uses default name', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: '',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName();

      expect(fileName).toBe('Untitled Meeting.md');
    });

    it('handles topic with only unsafe characters - uses default name', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: '/*?"<>|',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName();

      expect(fileName).toBe('Untitled Meeting.md');
    });

    it('limits filename length to 200 characters before extension', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'A'.repeat(250),
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName();

      expect(fileName.length).toBeLessThanOrEqual(203); // 200 + '.md'
      expect(fileName).toBe('A'.repeat(200) + '.md');
    });

    it('appends meeting ID when includeId is true', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Team Meeting',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName(true);

      expect(fileName).toBe('Team Meeting (123456789).md');
    });

    it('does not append meeting ID when includeId is false', () => {
      const recording: ZoomRecording = {
        uuid: 'test-uuid',
        id: 123456789,
        account_id: 'acc-123',
        host_id: 'host-456',
        topic: 'Team Meeting',
        type: 2,
        start_time: '2025-01-15T09:00:00Z',
        duration: 30,
        total_size: 1000000,
        recording_count: 1,
        recording_files: [],
      };

      const writer = new TranscriptWriter(recording);
      const fileName = writer.generateFileName(false);

      expect(fileName).toBe('Team Meeting.md');
    });
  });
});
