/**
 * Mock implementation of Obsidian's requestUrl function for testing.
 * Allows configuring mock responses for different URLs.
 */

import { vi } from 'vitest';

/**
 * Response type matching Obsidian's RequestUrlResponse
 */
export interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
  arrayBuffer: ArrayBuffer;
}

/**
 * Request options type matching Obsidian's RequestUrlParam
 */
export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  contentType?: string;
  throw?: boolean;
}

/**
 * Mock response configuration
 */
export interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string | object;
}

/**
 * Mock URL handler function type
 */
export type MockUrlHandler = (params: RequestUrlParam) => MockResponse | Promise<MockResponse>;

/**
 * MockRequestUrl manages mock responses for the requestUrl function.
 * Supports exact URL matching, pattern matching, and custom handlers.
 */
export class MockRequestUrl {
  private exactMatches: Map<string, MockResponse | MockUrlHandler> = new Map();
  private patternMatches: Array<{ pattern: RegExp; response: MockResponse | MockUrlHandler }> = [];
  private defaultResponse: MockResponse = { status: 404, body: 'Not Found' };
  private callHistory: RequestUrlParam[] = [];

  /**
   * Sets a mock response for an exact URL match.
   * @param url - The exact URL to match
   * @param response - The mock response or handler function
   */
  setResponse(url: string, response: MockResponse | MockUrlHandler): void {
    this.exactMatches.set(url, response);
  }

  /**
   * Sets a mock response for URLs matching a pattern.
   * @param pattern - RegExp pattern to match URLs
   * @param response - The mock response or handler function
   */
  setPatternResponse(pattern: RegExp, response: MockResponse | MockUrlHandler): void {
    this.patternMatches.push({ pattern, response });
  }

  /**
   * Sets the default response for unmatched URLs.
   * @param response - The default mock response
   */
  setDefaultResponse(response: MockResponse): void {
    this.defaultResponse = response;
  }

  /**
   * Clears all mock configurations.
   */
  clear(): void {
    this.exactMatches.clear();
    this.patternMatches = [];
    this.defaultResponse = { status: 404, body: 'Not Found' };
    this.callHistory = [];
  }

  /**
   * Gets the call history for verification in tests.
   * @returns Array of all request parameters
   */
  getCallHistory(): RequestUrlParam[] {
    return [...this.callHistory];
  }

  /**
   * Gets the last call parameters.
   * @returns The last request parameters or undefined
   */
  getLastCall(): RequestUrlParam | undefined {
    return this.callHistory[this.callHistory.length - 1];
  }

  /**
   * Gets calls matching a URL pattern.
   * @param pattern - RegExp or string to match URLs
   * @returns Array of matching request parameters
   */
  getCallsMatching(pattern: RegExp | string): RequestUrlParam[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return this.callHistory.filter(call => regex.test(call.url));
  }

  /**
   * Creates the mock requestUrl function.
   * @returns A mock function that can be used in place of Obsidian's requestUrl
   */
  createMockFunction(): (params: RequestUrlParam) => Promise<RequestUrlResponse> {
    return async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
      this.callHistory.push(params);

      // Find matching response
      let responseConfig: MockResponse | MockUrlHandler | undefined;

      // Check exact matches first
      responseConfig = this.exactMatches.get(params.url);

      // If no exact match, check pattern matches
      if (!responseConfig) {
        for (const { pattern, response } of this.patternMatches) {
          if (pattern.test(params.url)) {
            responseConfig = response;
            break;
          }
        }
      }

      // Use default if no match found
      if (!responseConfig) {
        responseConfig = this.defaultResponse;
      }

      // Resolve handler function if needed
      const resolved = typeof responseConfig === 'function'
        ? await responseConfig(params)
        : responseConfig;

      // Build response object
      const bodyStr = typeof resolved.body === 'object'
        ? JSON.stringify(resolved.body)
        : resolved.body || '';

      const response: RequestUrlResponse = {
        status: resolved.status,
        headers: resolved.headers || {},
        text: bodyStr,
        json: typeof resolved.body === 'object' ? resolved.body : tryParseJson(bodyStr),
        arrayBuffer: new TextEncoder().encode(bodyStr).buffer,
      };

      return response;
    };
  }
}

/**
 * Try to parse a string as JSON, returning the string if parsing fails.
 */
function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * Global mock instance for easy access in tests.
 */
export const mockRequestUrl = new MockRequestUrl();

/**
 * The mock requestUrl function.
 * This is exported as the default mock to replace Obsidian's requestUrl.
 */
export const requestUrl = mockRequestUrl.createMockFunction();

/**
 * Creates a vi.fn() mock for requestUrl with the MockRequestUrl instance.
 * Useful when you need to use vi.mock() with additional spy capabilities.
 */
export function createRequestUrlMock(): {
  mock: MockRequestUrl;
  fn: ReturnType<typeof vi.fn>;
} {
  const mock = new MockRequestUrl();
  const fn = vi.fn(mock.createMockFunction());
  return { mock, fn };
}

/**
 * Helper to create common mock responses.
 */
export const mockResponses = {
  /**
   * Creates a successful JSON response.
   */
  json(data: object, status = 200): MockResponse {
    return {
      status,
      headers: { 'content-type': 'application/json' },
      body: data,
    };
  },

  /**
   * Creates a successful text response.
   */
  text(content: string, status = 200): MockResponse {
    return {
      status,
      headers: { 'content-type': 'text/plain' },
      body: content,
    };
  },

  /**
   * Creates an error response.
   */
  error(status: number, message = 'Error'): MockResponse {
    return {
      status,
      body: { error: message },
    };
  },

  /**
   * Creates a rate limit (429) response with optional Retry-After header.
   */
  rateLimit(retryAfterSeconds?: number): MockResponse {
    const headers: Record<string, string> = {};
    if (retryAfterSeconds !== undefined) {
      headers['Retry-After'] = String(retryAfterSeconds);
    }
    return {
      status: 429,
      headers,
      body: { error: 'Rate limited' },
    };
  },

  /**
   * Creates an OAuth token response.
   */
  oauthToken(accessToken: string, expiresIn = 3600): MockResponse {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: expiresIn,
      },
    };
  },
};
