/**
 * Integration tests for ZoomApiClient with mock HTTP responses.
 * Tests subtasks 21.1, 21.4, and 21.5 from the specification.
 *
 * 21.1 - ZoomApiClient with mock HTTP
 * 21.4 - Pagination with many recordings
 * 21.5 - Error recovery scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ZoomApiClient, RateLimitError } from '../src/zoom-api';
import { ZoomSyncSettings, ZoomRecording, ZoomListRecordingsResponse } from '../src/types';
import { mockRequestUrl, mockResponses, MockResponse } from './mocks/requestUrl';

// Mock the obsidian module's requestUrl
vi.mock('obsidian', async () => {
  const { mockRequestUrl } = await import('./mocks/requestUrl');
  return {
    requestUrl: mockRequestUrl.createMockFunction(),
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

describe('ZoomApiClient Integration Tests', () => {
  let client: ZoomApiClient;
  const testSettings: ZoomSyncSettings = {
    accountId: 'test-account-id',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    userEmail: 'test@example.com',
    transcriptFolder: 'zoom-transcripts',
    syncIntervalMinutes: 30,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00.000Z'));

    // Clear mock state
    mockRequestUrl.clear();

    // Setup OAuth token response (use pattern to match URL with query params)
    mockRequestUrl.setPatternResponse(
      /zoom\.us\/oauth\/token/,
      mockResponses.oauthToken('test-access-token', 3600)
    );

    // Create fresh client for each test
    client = new ZoomApiClient(testSettings);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================================
  // 21.1 - ZoomApiClient with mock HTTP
  // ============================================================================
  describe('21.1 - ZoomApiClient with mock HTTP', () => {
    describe('listRecordings', () => {
      it('returns recordings with transcripts', async () => {
        const recording1 = createMockRecording({ id: 111111111, topic: 'Meeting One' });
        const recording2 = createMockRecording({ id: 222222222, topic: 'Meeting Two' });

        mockRequestUrl.setPatternResponse(
          /api\.zoom\.us\/v2\/users\/[^/]+\/recordings/,
          mockResponses.json(createMockListResponse([recording1, recording2]))
        );

        const recordings = await client.listRecordings();

        expect(recordings).toHaveLength(2);
        expect(recordings[0].topic).toBe('Meeting One');
        expect(recordings[1].topic).toBe('Meeting Two');

        // Verify both have transcript files
        for (const recording of recordings) {
          const hasTranscript = recording.recording_files.some(
            (f) => f.recording_type === 'audio_transcript'
          );
          expect(hasTranscript).toBe(true);
        }
      });

      it('filters out recordings without audio_transcript', async () => {
        const recordingWithTranscript = createMockRecording({
          id: 111111111,
          topic: 'With Transcript',
        });

        // Create recording without transcript
        const recordingWithoutTranscript = createMockRecording({
          id: 222222222,
          topic: 'Without Transcript',
          recording_files: [
            {
              id: 'file-222-1',
              meeting_id: '222222222',
              recording_start: '2025-01-15T10:00:00Z',
              recording_end: '2025-01-15T11:00:00Z',
              file_type: 'MP4',
              file_extension: 'mp4',
              file_size: 500000,
              play_url: 'https://zoom.us/play/222',
              download_url: 'https://zoom.us/download/222/video.mp4',
              status: 'completed',
              recording_type: 'shared_screen_with_speaker_view',
            },
            // No audio_transcript file
          ],
        });

        mockRequestUrl.setPatternResponse(
          /api\.zoom\.us\/v2\/users\/[^/]+\/recordings/,
          mockResponses.json(
            createMockListResponse([recordingWithTranscript, recordingWithoutTranscript])
          )
        );

        const recordings = await client.listRecordings();

        expect(recordings).toHaveLength(1);
        expect(recordings[0].topic).toBe('With Transcript');
      });

      it('uses from parameter correctly', async () => {
        mockRequestUrl.setPatternResponse(
          /api\.zoom\.us\/v2\/users\/[^/]+\/recordings/,
          mockResponses.json(createMockListResponse([]))
        );

        await client.listRecordings('2025-01-10');

        const calls = mockRequestUrl.getCallsMatching(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('from=2025-01-10');
      });

      it('uses Date object for from parameter correctly', async () => {
        mockRequestUrl.setPatternResponse(
          /api\.zoom\.us\/v2\/users\/[^/]+\/recordings/,
          mockResponses.json(createMockListResponse([]))
        );

        const fromDate = new Date('2025-01-12T00:00:00Z');
        await client.listRecordings(fromDate);

        const calls = mockRequestUrl.getCallsMatching(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('from=2025-01-12');
      });
    });

    describe('downloadTranscript', () => {
      it('returns VTT content', async () => {
        const vttContent = `WEBVTT

1
00:00:00.000 --> 00:00:05.000
Speaker One: Hello, welcome to the meeting.

2
00:00:05.500 --> 00:00:10.000
Speaker Two: Thanks for having me.`;

        mockRequestUrl.setResponse(
          'https://zoom.us/download/123/transcript.vtt',
          mockResponses.text(vttContent)
        );

        const result = await client.downloadTranscript('https://zoom.us/download/123/transcript.vtt');

        expect(result).toBe(vttContent);
        expect(result).toContain('WEBVTT');
        expect(result).toContain('Speaker One');
        expect(result).toContain('Speaker Two');
      });
    });
  });

  // ============================================================================
  // 21.4 - Pagination with many recordings
  // ============================================================================
  describe('21.4 - Pagination', () => {
    it('handles pagination with next_page_token', async () => {
      const page1Recordings = [
        createMockRecording({ id: 111111111, topic: 'Page 1 Meeting 1' }),
        createMockRecording({ id: 111111112, topic: 'Page 1 Meeting 2' }),
      ];

      const page2Recordings = [
        createMockRecording({ id: 222222221, topic: 'Page 2 Meeting 1' }),
        createMockRecording({ id: 222222222, topic: 'Page 2 Meeting 2' }),
      ];

      let callCount = 0;
      mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, (params) => {
        callCount++;
        if (callCount === 1) {
          return mockResponses.json(createMockListResponse(page1Recordings, 'token-page-2'));
        } else {
          return mockResponses.json(createMockListResponse(page2Recordings, ''));
        }
      });

      const recordings = await client.listRecordings();

      expect(recordings).toHaveLength(4);
      expect(callCount).toBe(2);

      // Verify recordings from both pages
      const topics = recordings.map((r) => r.topic);
      expect(topics).toContain('Page 1 Meeting 1');
      expect(topics).toContain('Page 1 Meeting 2');
      expect(topics).toContain('Page 2 Meeting 1');
      expect(topics).toContain('Page 2 Meeting 2');
    });

    it('accumulates all pages of results', async () => {
      const page1Recordings = [createMockRecording({ id: 100, topic: 'Meeting 100' })];
      const page2Recordings = [createMockRecording({ id: 200, topic: 'Meeting 200' })];
      const page3Recordings = [createMockRecording({ id: 300, topic: 'Meeting 300' })];

      let callCount = 0;
      mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
        callCount++;
        if (callCount === 1) {
          return mockResponses.json(createMockListResponse(page1Recordings, 'token-2'));
        } else if (callCount === 2) {
          return mockResponses.json(createMockListResponse(page2Recordings, 'token-3'));
        } else {
          return mockResponses.json(createMockListResponse(page3Recordings, ''));
        }
      });

      const recordings = await client.listRecordings();

      expect(recordings).toHaveLength(3);
      expect(callCount).toBe(3);

      // Verify all recordings are accumulated in order
      expect(recordings[0].id).toBe(100);
      expect(recordings[1].id).toBe(200);
      expect(recordings[2].id).toBe(300);
    });

    it('handles pagination with 3+ pages of results', async () => {
      // Create recordings for 4 pages
      const pageRecordings: ZoomRecording[][] = [];
      for (let page = 1; page <= 4; page++) {
        const recordings = [];
        for (let i = 1; i <= 5; i++) {
          recordings.push(
            createMockRecording({
              id: page * 1000 + i,
              topic: `Page ${page} Meeting ${i}`,
            })
          );
        }
        pageRecordings.push(recordings);
      }

      let callCount = 0;
      mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
        callCount++;
        const pageIndex = callCount - 1;
        const nextToken = callCount < 4 ? `token-page-${callCount + 1}` : '';
        return mockResponses.json(createMockListResponse(pageRecordings[pageIndex], nextToken));
      });

      const recordings = await client.listRecordings();

      // 4 pages * 5 recordings = 20 total
      expect(recordings).toHaveLength(20);
      expect(callCount).toBe(4);

      // Verify recordings from all pages are present
      expect(recordings.some((r) => r.topic === 'Page 1 Meeting 1')).toBe(true);
      expect(recordings.some((r) => r.topic === 'Page 4 Meeting 5')).toBe(true);
    });

    it('passes next_page_token correctly in subsequent requests', async () => {
      const page1Recordings = [createMockRecording({ id: 111 })];
      const page2Recordings = [createMockRecording({ id: 222 })];

      let callCount = 0;
      mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
        callCount++;
        if (callCount === 1) {
          return mockResponses.json(createMockListResponse(page1Recordings, 'my-next-token'));
        } else {
          return mockResponses.json(createMockListResponse(page2Recordings, ''));
        }
      });

      await client.listRecordings();

      const calls = mockRequestUrl.getCallsMatching(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/);
      expect(calls).toHaveLength(2);

      // First call should not have next_page_token
      expect(calls[0].url).not.toContain('next_page_token');

      // Second call should have next_page_token
      expect(calls[1].url).toContain('next_page_token=my-next-token');
    });
  });

  // ============================================================================
  // 21.5 - Error recovery scenarios
  // ============================================================================
  describe('21.5 - Error recovery', () => {
    describe('listRecordings retries', () => {
      it('retries on network errors', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          if (callCount < 3) {
            throw new Error('Network error: ECONNRESET');
          }
          return mockResponses.json(createMockListResponse([createMockRecording({ id: 123 })]));
        });

        const recordingsPromise = client.listRecordings();

        // Advance time for backoff delays (1s + 3s = 4s total)
        await vi.advanceTimersByTimeAsync(4000);

        const recordings = await recordingsPromise;

        expect(recordings).toHaveLength(1);
        expect(callCount).toBe(3); // 2 failures + 1 success
      });

      it('retries on 5xx errors', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          if (callCount < 2) {
            throw new Error('Failed to list recordings: 503');
          }
          return mockResponses.json(createMockListResponse([createMockRecording({ id: 456 })]));
        });

        const recordingsPromise = client.listRecordings();

        // Advance time for backoff delay (1s)
        await vi.advanceTimersByTimeAsync(1000);

        const recordings = await recordingsPromise;

        expect(recordings).toHaveLength(1);
        expect(callCount).toBe(2);
      });

      it('handles 429 rate limit with Retry-After', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          if (callCount === 1) {
            return mockResponses.rateLimit(5); // Retry after 5 seconds
          }
          return mockResponses.json(createMockListResponse([createMockRecording({ id: 789 })]));
        });

        const recordingsPromise = client.listRecordings();

        // Advance time for the Retry-After delay
        await vi.advanceTimersByTimeAsync(5000);

        const recordings = await recordingsPromise;

        expect(recordings).toHaveLength(1);
        expect(callCount).toBe(2);
      });

      it('throws error after max retries', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          throw new Error('Network error: timeout');
        });

        // Run the promise and time advancement together
        const listPromise = client.listRecordings().catch((e) => e);

        // Advance time for all backoff delays (1s + 3s = 4s total)
        await vi.advanceTimersByTimeAsync(4000);

        const error = await listPromise;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('Network error: timeout');
        expect(callCount).toBe(3); // MAX_ATTEMPTS = 3
      });

      it('does not retry on 401 auth errors', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          throw new Error('Failed to list recordings: 401');
        });

        await expect(client.listRecordings()).rejects.toThrow('401');
        expect(callCount).toBe(1); // No retries for 401
      });

      it('does not retry on 403 forbidden errors', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          throw new Error('Failed to list recordings: 403');
        });

        await expect(client.listRecordings()).rejects.toThrow('403');
        expect(callCount).toBe(1); // No retries for 403
      });
    });

    describe('downloadTranscript retries', () => {
      it('retries on failures', async () => {
        let callCount = 0;
        const downloadUrl = 'https://zoom.us/download/test/transcript.vtt';

        mockRequestUrl.setResponse(downloadUrl, () => {
          callCount++;
          if (callCount < 3) {
            throw new Error('Network error');
          }
          return mockResponses.text('WEBVTT\n\nTest content');
        });

        const contentPromise = client.downloadTranscript(downloadUrl);

        // Advance time for backoff delays (1s + 3s = 4s)
        await vi.advanceTimersByTimeAsync(4000);

        const content = await contentPromise;

        expect(content).toContain('WEBVTT');
        expect(callCount).toBe(3);
      });

      it('uses backoff delays between retries', async () => {
        let callCount = 0;
        const downloadUrl = 'https://zoom.us/download/backoff/transcript.vtt';

        mockRequestUrl.setResponse(downloadUrl, () => {
          callCount++;
          if (callCount < 3) {
            throw new Error('Network error: ECONNRESET');
          }
          return mockResponses.text('WEBVTT\n\nSuccess');
        });

        const contentPromise = client.downloadTranscript(downloadUrl);

        // Advance time for backoff delays (1s + 3s = 4s)
        await vi.advanceTimersByTimeAsync(4000);

        const content = await contentPromise;

        expect(content).toContain('WEBVTT');
        expect(callCount).toBe(3);
      });

      it('throws after max retries on download', async () => {
        let callCount = 0;
        const downloadUrl = 'https://zoom.us/download/failing/transcript.vtt';

        mockRequestUrl.setResponse(downloadUrl, () => {
          callCount++;
          throw new Error('Network timeout');
        });

        // Run the promise and time advancement together
        const downloadPromise = client.downloadTranscript(downloadUrl).catch((e) => e);

        // Advance time for backoff delays (1s + 3s = 4s)
        await vi.advanceTimersByTimeAsync(4000);

        const error = await downloadPromise;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('Network timeout');
        expect(callCount).toBe(3);
      });

      it('handles rate limit with Retry-After on download', async () => {
        let callCount = 0;
        const downloadUrl = 'https://zoom.us/download/ratelimit/transcript.vtt';

        mockRequestUrl.setResponse(downloadUrl, () => {
          callCount++;
          if (callCount === 1) {
            return mockResponses.rateLimit(2); // Retry after 2 seconds
          }
          return mockResponses.text('WEBVTT\n\nContent after rate limit');
        });

        const contentPromise = client.downloadTranscript(downloadUrl);

        // Advance time for rate limit delay
        await vi.advanceTimersByTimeAsync(2000);

        const content = await contentPromise;

        expect(content).toContain('Content after rate limit');
        expect(callCount).toBe(2);
      });
    });

    describe('error classification', () => {
      it('retries on timeout errors', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          if (callCount < 2) {
            throw new Error('Request timeout');
          }
          return mockResponses.json(createMockListResponse([]));
        });

        const listPromise = client.listRecordings();

        // Advance time for backoff delay (1s)
        await vi.advanceTimersByTimeAsync(1000);

        await listPromise;

        expect(callCount).toBe(2);
      });

      it('retries on 500 internal server error', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          if (callCount < 2) {
            throw new Error('Failed: 500');
          }
          return mockResponses.json(createMockListResponse([]));
        });

        const listPromise = client.listRecordings();

        // Advance time for backoff delay (1s)
        await vi.advanceTimersByTimeAsync(1000);

        await listPromise;

        expect(callCount).toBe(2);
      });

      it('retries on 502 bad gateway error', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          if (callCount < 2) {
            throw new Error('Bad Gateway: 502');
          }
          return mockResponses.json(createMockListResponse([]));
        });

        const listPromise = client.listRecordings();

        // Advance time for backoff delay (1s)
        await vi.advanceTimersByTimeAsync(1000);

        await listPromise;

        expect(callCount).toBe(2);
      });

      it('does not retry on 400 bad request', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          throw new Error('Bad request: 400');
        });

        await expect(client.listRecordings()).rejects.toThrow('400');
        expect(callCount).toBe(1);
      });

      it('does not retry on 404 not found', async () => {
        let callCount = 0;
        mockRequestUrl.setPatternResponse(/api\.zoom\.us\/v2\/users\/[^/]+\/recordings/, () => {
          callCount++;
          throw new Error('Not found: 404');
        });

        await expect(client.listRecordings()).rejects.toThrow('404');
        expect(callCount).toBe(1);
      });
    });
  });
});
