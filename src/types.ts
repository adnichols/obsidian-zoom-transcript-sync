export interface ZoomSyncSettings {
  accountId: string;
  clientId: string;
  clientSecret: string;
  transcriptFolder: string;     // default: "zoom-transcripts"
  syncIntervalMinutes: number;  // default: 30
  lastSyncTimestamp?: number;
}

export interface SyncState {
  version: 1;
  syncedMeetings: {
    [meetingId: string]: {
      syncedAt: number;       // Unix timestamp
      fileName: string;       // Relative path in vault
    };
  };
}
