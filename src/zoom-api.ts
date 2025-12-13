import { requestUrl, RequestUrlResponse } from 'obsidian';
import { ZoomSyncSettings, ZoomListRecordingsResponse, ZoomRecording } from './types';

/**
 * Custom error class for rate limit (429) responses.
 * Carries the Retry-After value if present in the response headers.
 */
export class RateLimitError extends Error {
  public readonly retryAfterMs: number | null;

  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

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
   * Determines if an error is retryable (network/server errors or rate limits).
   * @param error - The error to check
   * @returns true if the error should trigger a retry
   */
  private isRetryableError(error: unknown): boolean {
    // Rate limit errors are always retryable
    if (error instanceof RateLimitError) {
      return true;
    }

    // Network errors or server errors (5xx) should be retried
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Retry on network errors
      if (message.includes('network') || message.includes('timeout') || message.includes('econnreset')) {
        return true;
      }
      // Retry on server errors (5xx status codes) or rate limit (429)
      const statusMatch = message.match(/(\d{3})/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1], 10);
        return status === 429 || (status >= 500 && status < 600);
      }
    }
    return false;
  }

  /**
   * Handles a rate-limited (429) response by throwing a RateLimitError.
   * Extracts the Retry-After header if present and converts to milliseconds.
   * @param response - The response with 429 status
   * @throws RateLimitError with the retry delay if available
   */
  private handleRateLimitedResponse(response: RequestUrlResponse): never {
    let retryAfterMs: number | null = null;

    // Check for Retry-After header (case-insensitive)
    const headers = response.headers;
    if (headers) {
      // Headers may be lowercase or mixed case depending on the environment
      const retryAfterValue = headers['retry-after'] || headers['Retry-After'];
      if (retryAfterValue) {
        const retryAfterSeconds = parseInt(retryAfterValue, 10);
        if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
          retryAfterMs = retryAfterSeconds * 1000;
        }
      }
    }

    throw new RateLimitError(`Rate limited: 429`, retryAfterMs);
  }

  /**
   * Calculates the delay for a retry attempt.
   * Uses Retry-After value for rate limit errors, otherwise uses backoff delays.
   * @param error - The error that triggered the retry
   * @param attempt - The current attempt number (0-indexed)
   * @param backoffDelays - Array of backoff delays in milliseconds
   * @returns The delay in milliseconds before the next retry
   */
  private getRetryDelay(error: unknown, attempt: number, backoffDelays: number[]): number {
    // For rate limit errors with Retry-After, use that value
    if (error instanceof RateLimitError && error.retryAfterMs !== null) {
      return error.retryAfterMs;
    }
    // Otherwise use the standard backoff delay
    return backoffDelays[attempt] ?? backoffDelays[backoffDelays.length - 1];
  }

  /**
   * Fetches a new access token from Zoom OAuth endpoint.
   * Uses Server-to-Server OAuth with account_credentials grant type.
   *
   * Note: Uses query string parameters instead of body parameters as this
   * approach is more commonly successful per Zoom developer forum solutions.
   */
  private async fetchNewToken(): Promise<string> {
    const { accountId, clientId, clientSecret } = this.settings;

    // Create Basic Auth header from clientId:clientSecret (base64 encoded using UTF-8)
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    // Build URL with query parameters (more reliable than body parameters per Zoom forums)
    const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`;

    // Debug logging
    console.log('[ZoomSync] Fetching OAuth token...');
    console.log('[ZoomSync] Token URL:', tokenUrl);
    console.log('[ZoomSync] Account ID:', accountId);
    console.log('[ZoomSync] Client ID:', clientId ? `${clientId.substring(0, 4)}...` : 'EMPTY');

    let response;
    try {
      response = await requestUrl({
        url: tokenUrl,
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
        },
      });
    } catch (error) {
      // Obsidian throws errors for non-200 responses
      console.error('[ZoomSync] OAuth request error:', error);
      if (error instanceof Error) {
        console.error('[ZoomSync] Error message:', error.message);
        // Try to extract more details
        const anyError = error as unknown as Record<string, unknown>;
        if (anyError.response) {
          console.error('[ZoomSync] Response in error:', anyError.response);
        }
      }
      throw new Error(`OAuth token request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log('[ZoomSync] OAuth response status:', response.status);

    if (response.status !== 200) {
      // Try to get error details from response
      let errorDetail = '';
      try {
        const errorData = response.json;
        console.error('[ZoomSync] OAuth error response:', errorData);
        if (errorData && errorData.reason) {
          errorDetail = `: ${errorData.reason}`;
        } else if (errorData && errorData.error) {
          errorDetail = `: ${errorData.error}`;
        }
      } catch {
        // Ignore JSON parsing errors
      }
      throw new Error(`Failed to fetch access token: ${response.status}${errorDetail}`);
    }

    const data = response.json;
    console.log('[ZoomSync] OAuth success, token expires in:', data.expires_in, 'seconds');

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
   * Clears the cached access token.
   * Used when authentication fails to force a new token fetch on next request.
   */
  public clearAccessToken(): void {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Lists cloud recordings for specified users.
   * Calls GET https://api.zoom.us/v2/users/{email}/recordings for each user.
   * Handles pagination automatically using next_page_token.
   * Loops through months since Zoom limits date range to 1 month per request.
   * Includes retry logic with exponential backoff for network/server errors.
   *
   * Retry pattern:
   * - Attempt 1: immediate (no wait)
   * - Attempt 2: wait 1 second before retry
   * - Attempt 3: wait 3 seconds before retry
   * - After 3 failed attempts, throws the original error
   *
   * @param from - Optional start date filter (ISO 8601 string or Date object)
   * @returns Array of all recording objects across all pages, months, and users
   * @throws Error if all retry attempts fail or on non-retryable errors
   */
  /**
   * Lists all users in the Zoom account.
   * Requires scope: user:read:admin or user:read:list_users:admin
   */
  private async listAccountUsers(): Promise<string[]> {
    const token = await this.getAccessToken();
    const allEmails: string[] = [];
    let nextPageToken: string | undefined;

    console.log('[ZoomSync] Fetching all users in account...');

    do {
      const params: string[] = ['page_size=300'];
      if (nextPageToken) {
        params.push(`next_page_token=${encodeURIComponent(nextPageToken)}`);
      }
      const url = `https://api.zoom.us/v2/users?${params.join('&')}`;

      const response = await requestUrl({
        url,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        throw: false,
      });

      if (response.status !== 200) {
        console.error('[ZoomSync] Failed to list users:', response.status, response.json);
        throw new Error(`Failed to list users: ${response.status} - ${response.json?.message || 'Unknown error'}`);
      }

      const data = response.json;
      if (data.users) {
        for (const user of data.users) {
          if (user.email) {
            allEmails.push(user.email);
          }
        }
      }
      nextPageToken = data.next_page_token || undefined;
    } while (nextPageToken);

    console.log('[ZoomSync] Found', allEmails.length, 'users in account');
    return allEmails;
  }

  public async listRecordings(from?: string | Date): Promise<ZoomRecording[]> {
    const MAX_ATTEMPTS = 3;
    const BACKOFF_DELAYS = [0, 1000, 3000]; // immediate, 1s, 3s

    const token = await this.getAccessToken();
    const allRecordings: ZoomRecording[] = [];

    // Try to get all users in the account automatically
    let userEmails: string[];
    try {
      userEmails = await this.listAccountUsers();
    } catch (error) {
      console.log('[ZoomSync] Could not list account users, falling back to configured emails:', error);
      // Fall back to configured emails
      const userEmailsRaw = this.settings.userEmails || this.settings.userEmail || '';
      userEmails = userEmailsRaw.split(',').map(e => e.trim()).filter(e => e.length > 0);
    }

    if (userEmails.length === 0) {
      throw new Error('No users found. Please add the user:read:admin scope or configure user emails manually.');
    }

    // Determine start date - default to 6 months ago
    let startDate: Date;
    if (from) {
      startDate = from instanceof Date ? from : new Date(from);
    } else {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 6);
    }

    const endDate = new Date(); // Today

    console.log('[ZoomSync] User emails:', userEmails.join(', '));
    console.log('[ZoomSync] Fetching recordings from:', startDate.toISOString().split('T')[0], 'to:', endDate.toISOString().split('T')[0]);

    // Track seen recording UUIDs to avoid duplicates (same meeting, different hosts)
    const seenRecordingUuids = new Set<string>();

    // Loop through each user email
    for (const userEmail of userEmails) {
      console.log('[ZoomSync] Fetching recordings for user:', userEmail);
      const baseUrl = `https://api.zoom.us/v2/users/${encodeURIComponent(userEmail)}/recordings`;

      // Loop through each month since Zoom limits date range to 1 month per request
      let currentFrom = new Date(startDate);
      while (currentFrom < endDate) {
        // Calculate the end of this month's range (max 1 month)
        const currentTo = new Date(currentFrom);
        currentTo.setMonth(currentTo.getMonth() + 1);
        if (currentTo > endDate) {
          currentTo.setTime(endDate.getTime());
        }

        const fromDateStr = currentFrom.toISOString().split('T')[0];
        const toDateStr = currentTo.toISOString().split('T')[0];

        console.log('[ZoomSync] Fetching month range:', fromDateStr, 'to', toDateStr);

        let nextPageToken: string | undefined;

        do {
          // Build URL with query parameters
          const params: string[] = [];
          params.push(`from=${encodeURIComponent(fromDateStr)}`);
          params.push(`to=${encodeURIComponent(toDateStr)}`);
          if (nextPageToken) {
            params.push(`next_page_token=${encodeURIComponent(nextPageToken)}`);
          }
          const url = `${baseUrl}?${params.join('&')}`;

        let lastError: Error | null = null;
        let pageData: ZoomListRecordingsResponse | null = null;

        // Debug logging
        console.log('[ZoomSync] Listing recordings...');
        console.log('[ZoomSync] Request URL:', url);

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          // Apply delay before retry (no delay on first attempt)
          if (attempt > 0 && lastError) {
            const delayMs = this.getRetryDelay(lastError, attempt, BACKOFF_DELAYS);
            if (delayMs > 0) {
              await this.delay(delayMs);
            }
          }

          try {
            const response = await requestUrl({
              url: url,
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${token}`,
              },
              throw: false, // Don't throw on non-2xx, let us handle it
            });

            console.log('[ZoomSync] List recordings response status:', response.status);
            if (response.status !== 200) {
              console.error('[ZoomSync] API Error Response:', response.json);
            }

            // Handle rate limiting (429) with Retry-After header support
            if (response.status === 429) {
              this.handleRateLimitedResponse(response);
            }

            if (response.status !== 200) {
              console.error('[ZoomSync] List recordings error response:', response.json);
              throw new Error(`Failed to list recordings: ${response.status}`);
            }

            pageData = response.json;
            console.log('[ZoomSync] Found', pageData?.meetings?.length || 0, 'recordings in this page');
            break; // Success, exit retry loop
          } catch (error) {
            console.error('[ZoomSync] List recordings request error:', error);
            // Try to extract more details from the error
            if (error && typeof error === 'object') {
              const anyError = error as Record<string, unknown>;
              if (anyError.status) console.error('[ZoomSync] Error status:', anyError.status);
              if (anyError.response) console.error('[ZoomSync] Error response:', anyError.response);
              if (anyError.text) console.error('[ZoomSync] Error text:', anyError.text);
              if (anyError.json) console.error('[ZoomSync] Error json:', anyError.json);
              if (anyError.headers) console.error('[ZoomSync] Error headers:', anyError.headers);
            }
            lastError = error instanceof Error ? error : new Error(String(error));

            // Only retry on retryable errors (network/server errors or rate limits)
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

        // This should never be reached if retry loop worked correctly, but TypeScript needs it
        if (!pageData) {
          throw lastError ?? new Error('Failed to list recordings after retries');
        }

        // Accumulate recordings from this page, deduplicating by UUID
        if (pageData.meetings) {
          for (const meeting of pageData.meetings) {
            if (!seenRecordingUuids.has(meeting.uuid)) {
              seenRecordingUuids.add(meeting.uuid);
              allRecordings.push(meeting);
            }
          }
        }

        // Get next page token for pagination
        nextPageToken = pageData.next_page_token || undefined;
        } while (nextPageToken);

        // Move to next month
        currentFrom.setMonth(currentFrom.getMonth() + 1);
      }
    }

    console.log('[ZoomSync] Total unique recordings found across all users/months:', allRecordings.length);

    // Filter to only include recordings that have at least one audio_transcript file
    const recordingsWithTranscripts = allRecordings.filter(recording =>
      recording.recording_files?.some(file => file.recording_type === 'audio_transcript')
    );

    console.log('[ZoomSync] Recordings with transcripts:', recordingsWithTranscripts.length);

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
      if (attempt > 0 && lastError) {
        const delayMs = this.getRetryDelay(lastError, attempt, BACKOFF_DELAYS);
        if (delayMs > 0) {
          await this.delay(delayMs);
        }
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

        // Handle rate limiting (429) with Retry-After header support
        if (response.status === 429) {
          this.handleRateLimitedResponse(response);
        }

        if (response.status !== 200) {
          throw new Error(`Failed to download transcript: ${response.status}`);
        }

        return response.text;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Only retry on retryable errors (network/server errors or rate limits)
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
