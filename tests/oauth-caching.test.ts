/**
 * Unit tests for OAuth token caching logic.
 * Tests ZoomApiClient class OAuth token methods from src/zoom-api.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ZoomApiClient } from '../src/zoom-api';
import { ZoomSyncSettings } from '../src/types';
import { mockRequestUrl, mockResponses } from './mocks/requestUrl';

// Mock the obsidian module's requestUrl
vi.mock('obsidian', async () => {
  const { mockRequestUrl } = await import('./mocks/requestUrl');
  return {
    requestUrl: mockRequestUrl.createMockFunction(),
  };
});

describe('ZoomApiClient - OAuth Token Caching', () => {
  let client: ZoomApiClient;
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

    // Clear mock state
    mockRequestUrl.clear();

    // Create fresh client for each test
    client = new ZoomApiClient(testSettings);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getAccessToken', () => {
    it('fetches new token when none cached', async () => {
      // Setup mock response for OAuth token endpoint
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('fresh-token-abc', 3600)
      );

      const token = await client.getAccessToken();

      expect(token).toBe('fresh-token-abc');

      // Verify the OAuth endpoint was called
      const calls = mockRequestUrl.getCallsMatching(/zoom\.us\/oauth\/token/);
      expect(calls).toHaveLength(1);

      // Verify correct headers were sent
      const call = calls[0];
      expect(call.method).toBe('POST');
      expect(call.headers?.['Authorization']).toMatch(/^Basic /);

      // Verify URL contains grant_type and account_id as query parameters
      expect(call.url).toContain('grant_type=account_credentials');
      expect(call.url).toContain('account_id=test-account-id');
    });

    it('returns cached token when valid', async () => {
      // Setup mock response
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('cached-token-xyz', 3600)
      );

      // First call - fetches new token
      const token1 = await client.getAccessToken();
      expect(token1).toBe('cached-token-xyz');

      // Clear call history to verify second call doesn't hit the endpoint
      mockRequestUrl.clear();

      // Re-setup mock (in case it's needed, but should NOT be called)
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('different-token', 3600)
      );

      // Second call - should return cached token
      const token2 = await client.getAccessToken();
      expect(token2).toBe('cached-token-xyz');

      // Verify OAuth endpoint was NOT called second time
      const calls = mockRequestUrl.getCallsMatching(/zoom\.us\/oauth\/token/);
      expect(calls).toHaveLength(0);
    });

    it('fetches new token when expired', async () => {
      // Setup mock response for first token
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('first-token', 3600) // expires in 1 hour
      );

      // First call - get initial token
      const token1 = await client.getAccessToken();
      expect(token1).toBe('first-token');

      // Advance time past expiry (more than 1 hour)
      vi.advanceTimersByTime(3700 * 1000); // 3700 seconds = ~1 hour 2 minutes

      // Setup mock response for refreshed token
      mockRequestUrl.clear();
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('refreshed-token', 3600)
      );

      // Second call - should fetch new token since expired
      const token2 = await client.getAccessToken();
      expect(token2).toBe('refreshed-token');

      // Verify OAuth endpoint was called for refresh
      const calls = mockRequestUrl.getCallsMatching(/zoom\.us\/oauth\/token/);
      expect(calls).toHaveLength(1);
    });

    it('fetches new token when within 60 second buffer before expiry', async () => {
      // Setup mock response for first token (expires in 90 seconds)
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('short-lived-token', 90)
      );

      // First call - get initial token
      const token1 = await client.getAccessToken();
      expect(token1).toBe('short-lived-token');

      // Advance time to 31 seconds before expiry
      // Token expires at T+90s, so at T+31s there's only 59s left (< 60s buffer)
      vi.advanceTimersByTime(31 * 1000);

      // Setup mock response for refreshed token
      mockRequestUrl.clear();
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('new-token-after-buffer', 3600)
      );

      // Second call - should fetch new token because we're within 60s buffer
      const token2 = await client.getAccessToken();
      expect(token2).toBe('new-token-after-buffer');

      // Verify OAuth endpoint was called
      const calls = mockRequestUrl.getCallsMatching(/zoom\.us\/oauth\/token/);
      expect(calls).toHaveLength(1);
    });

    it('returns cached token when just outside 60 second buffer', async () => {
      // Setup mock response for first token (expires in 120 seconds)
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('medium-lived-token', 120)
      );

      // First call - get initial token
      const token1 = await client.getAccessToken();
      expect(token1).toBe('medium-lived-token');

      // Advance time to 59 seconds (61 seconds remaining, just outside buffer)
      vi.advanceTimersByTime(59 * 1000);

      // Clear call history
      mockRequestUrl.clear();

      // Re-setup mock (should NOT be called)
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('should-not-be-used', 3600)
      );

      // Second call - should return cached token (61s > 60s buffer)
      const token2 = await client.getAccessToken();
      expect(token2).toBe('medium-lived-token');

      // Verify OAuth endpoint was NOT called
      const calls = mockRequestUrl.getCallsMatching(/zoom\.us\/oauth\/token/);
      expect(calls).toHaveLength(0);
    });

    it('handles token fetch error', async () => {
      // Setup mock response for OAuth error
      mockRequestUrl.setPatternResponse(/zoom.us\/oauth\/token/, {
        status: 401,
        body: { error: 'invalid_client' },
      });

      await expect(client.getAccessToken()).rejects.toThrow(
        'Failed to fetch access token: 401'
      );
    });

    it('handles missing access_token in response', async () => {
      // Setup mock response without access_token
      mockRequestUrl.setPatternResponse(/zoom.us\/oauth\/token/, {
        status: 200,
        body: { token_type: 'bearer' }, // missing access_token
      });

      await expect(client.getAccessToken()).rejects.toThrow(
        'No access_token in response'
      );
    });
  });

  describe('clearAccessToken', () => {
    it('clears cached token', async () => {
      // Setup mock response
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('original-token', 3600)
      );

      // First call - get token and cache it
      const token1 = await client.getAccessToken();
      expect(token1).toBe('original-token');

      // Clear the token
      client.clearAccessToken();

      // Setup new mock response for next fetch
      mockRequestUrl.clear();
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('new-token-after-clear', 3600)
      );

      // Second call - should fetch new token since cache was cleared
      const token2 = await client.getAccessToken();
      expect(token2).toBe('new-token-after-clear');

      // Verify OAuth endpoint was called after clear
      const calls = mockRequestUrl.getCallsMatching(/zoom\.us\/oauth\/token/);
      expect(calls).toHaveLength(1);
    });

    it('can be called safely when no token is cached', () => {
      // Should not throw when called without any prior token fetch
      expect(() => client.clearAccessToken()).not.toThrow();
    });

    it('allows fetching new token after clear even if not expired', async () => {
      // Setup mock response for first token
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('first-token', 3600)
      );

      // Get initial token
      await client.getAccessToken();

      // Clear immediately (token still valid)
      client.clearAccessToken();

      // Setup new mock response
      mockRequestUrl.clear();
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('second-token', 3600)
      );

      // Should fetch new token regardless of time
      const token = await client.getAccessToken();
      expect(token).toBe('second-token');
    });
  });

  describe('token caching integration', () => {
    it('multiple sequential calls use cached token efficiently', async () => {
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('efficient-token', 3600)
      );

      // Make multiple sequential calls (not parallel)
      const token1 = await client.getAccessToken();
      const token2 = await client.getAccessToken();
      const token3 = await client.getAccessToken();

      // All should return same token
      expect(token1).toBe('efficient-token');
      expect(token2).toBe('efficient-token');
      expect(token3).toBe('efficient-token');

      // Only one call should have been made to OAuth endpoint
      const calls = mockRequestUrl.getCallsMatching(/zoom\.us\/oauth\/token/);
      expect(calls).toHaveLength(1);
    });

    it('uses correct Basic Auth encoding for credentials', async () => {
      mockRequestUrl.setPatternResponse(
        /zoom.us\/oauth\/token/,
        mockResponses.oauthToken('token', 3600)
      );

      await client.getAccessToken();

      const calls = mockRequestUrl.getCallsMatching(/zoom\.us\/oauth\/token/);
      const authHeader = calls[0].headers?.['Authorization'];

      // Basic auth should be base64(clientId:clientSecret)
      const expectedBasicAuth = btoa('test-client-id:test-client-secret');
      expect(authHeader).toBe(`Basic ${expectedBasicAuth}`);
    });
  });
});
