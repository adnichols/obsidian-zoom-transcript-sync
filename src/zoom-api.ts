import { requestUrl } from 'obsidian';
import { ZoomSyncSettings } from './types';

export class ZoomApiClient {
  private settings: ZoomSyncSettings;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(settings: ZoomSyncSettings) {
    this.settings = settings;
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
}
