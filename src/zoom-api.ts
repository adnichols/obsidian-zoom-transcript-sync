import { requestUrl } from 'obsidian';
import { ZoomSyncSettings, ZoomListRecordingsResponse, ZoomRecording } from './types';

/**
 * Extracts participant names from a Zoom recording's metadata.
 * Looks for participant info in the `participant_audio_files` array.
 * Each entry has a `file_name` like "John Smith's audio.m4a" from which
 * the participant name is extracted.
 *
 * @param recording - The Zoom recording object
 * @returns Array of unique participant names, or empty array if not available
 */
export function extractParticipantsFromRecording(recording: ZoomRecording): string[] {
  // Return empty array if no participant_audio_files present
  if (!recording.participant_audio_files || !Array.isArray(recording.participant_audio_files)) {
    return [];
  }

  const names: string[] = [];

  for (const audioFile of recording.participant_audio_files) {
    // Skip entries without file_name
    if (!audioFile.file_name) {
      continue;
    }

    // Extract name from file_name pattern like "John Smith's audio.m4a"
    // Remove the "'s audio" suffix and file extension
    const fileName = audioFile.file_name;

    // Pattern: "Name's audio.ext" - extract the name before "'s audio"
    const match = fileName.match(/^(.+?)'s audio\./i);
    if (match && match[1]) {
      const name = match[1].trim();
      if (name && !names.includes(name)) {
        names.push(name);
      }
    }
  }

  return names;
}

export class ZoomApiClient {
  private settings: ZoomSyncSettings;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(settings: ZoomSyncSettings) {
    this.settings = settings;
  }

  /**
   * Helper method to create a delay using setTimeout wrapped in a Promise.
   * @param ms - The number of milliseconds to wait
   * @returns A Promise that resolves after the specified delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Determines if an error is retryable (network/server errors).
   * @param error - The error to check
   * @returns true if the error should trigger a retry
   */
  private isRetryableError(error: unknown): boolean {
    // Network errors or server errors (5xx) should be retried
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Retry on network errors
      if (message.includes('network') || message.includes('timeout') || message.includes('econnreset')) {
        return true;
      }
      // Retry on server errors (5xx status codes)
      const statusMatch = message.match(/(\d{3})/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1], 10);
        return status >= 500 && status < 600;
      }
    }
    return false;
  }

  /**
   * Fetches a new access token from Zoom OAuth endpoint.
   * Uses Server-to-Server OAuth with account_credentials grant type.
   */
  private async fetchNewToken(): Promise<string> {
    const { accountId, clientId, clientSecret } = this.settings;

    // Create Basic Auth header from clientId:clientSecret (base64 encoded)
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    // Request body (form-urlencoded)
    const body = `grant_type=account_credentials&account_id=${accountId}`;

    const response = await requestUrl({
      url: 'https://zoom.us/oauth/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch access token: ${response.status}`);
    }

    const data = response.json;

    if (!data.access_token) {
      throw new Error('No access_token in response');
    }

    // Store token and calculate expiry time (current time + expires_in seconds)
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);

    return data.access_token;
  }

  /**
   * Gets an access token for Zoom API requests.
   * Returns cached token if valid, otherwise fetches a new one.
   * Uses a 60 second buffer before expiry to avoid edge cases.
   */
  public async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token (with 60 second buffer before expiry)
    if (this.accessToken && this.tokenExpiresAt > Date.now() + 60000) {
      return this.accessToken;
    }
    // Fetch new token if expired or not present
    return this.fetchNewToken();
  }

  /**
   * Lists cloud recordings for the authenticated user.
   * Calls GET https://api.zoom.us/v2/users/me/recordings
   * Handles pagination automatically using next_page_token.
   *
   * @param from - Optional start date filter (ISO 8601 string or Date object)
   * @returns Array of all recording objects across all pages
   */
  public async listRecordings(from?: string | Date): Promise<ZoomRecording[]> {
    const token = await this.getAccessToken();
    const allRecordings: ZoomRecording[] = [];
    let nextPageToken: string | undefined;

    // Build base URL with optional from parameter
    const baseUrl = 'https://api.zoom.us/v2/users/me/recordings';
    const fromDate = from
      ? (from instanceof Date ? from.toISOString().split('T')[0] : from)
      : undefined;

    do {
      // Build URL with query parameters
      const params: string[] = [];
      if (fromDate) {
        params.push(`from=${encodeURIComponent(fromDate)}`);
      }
      if (nextPageToken) {
        params.push(`next_page_token=${encodeURIComponent(nextPageToken)}`);
      }
      const url = params.length > 0 ? `${baseUrl}?${params.join('&')}` : baseUrl;

      const response = await requestUrl({
        url: url,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status !== 200) {
        throw new Error(`Failed to list recordings: ${response.status}`);
      }

      const data: ZoomListRecordingsResponse = response.json;

      // Accumulate recordings from this page
      if (data.meetings) {
        allRecordings.push(...data.meetings);
      }

      // Get next page token for pagination
      nextPageToken = data.next_page_token || undefined;
    } while (nextPageToken);

    // Filter to only include recordings that have at least one audio_transcript file
    const recordingsWithTranscripts = allRecordings.filter(recording =>
      recording.recording_files?.some(file => file.recording_type === 'audio_transcript')
    );

    return recordingsWithTranscripts;
  }

  /**
   * Downloads a transcript file from Zoom.
   * Uses Bearer token authentication as required by Zoom download URLs.
   * Includes retry logic with exponential backoff for network/server errors.
   *
   * Retry pattern:
   * - Attempt 1: immediate (no wait)
   * - Attempt 2: wait 1 second before retry
   * - Attempt 3: wait 3 seconds before retry
   * - After 3 failed attempts, throws the original error
   *
   * @param downloadUrl - The download URL from a ZoomRecordingFile
   * @returns The raw VTT content as a string
   * @throws Error if all retry attempts fail or on non-retryable errors
   */
  public async downloadTranscript(downloadUrl: string): Promise<string> {
    const MAX_ATTEMPTS = 3;
    const BACKOFF_DELAYS = [0, 1000, 3000]; // immediate, 1s, 3s

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Apply delay before retry (no delay on first attempt)
      if (attempt > 0 && BACKOFF_DELAYS[attempt] > 0) {
        await this.delay(BACKOFF_DELAYS[attempt]);
      }

      try {
        const token = await this.getAccessToken();

        const response = await requestUrl({
          url: downloadUrl,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.status !== 200) {
          throw new Error(`Failed to download transcript: ${response.status}`);
        }

        return response.text;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Only retry on retryable errors (network/server errors)
        if (!this.isRetryableError(error)) {
          throw lastError;
        }

        // If this was the last attempt, throw the error
        if (attempt === MAX_ATTEMPTS - 1) {
          throw lastError;
        }
        // Otherwise, continue to next attempt (loop will apply delay)
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError ?? new Error('Download failed after retries');
  }
}
