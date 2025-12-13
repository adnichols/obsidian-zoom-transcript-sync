export interface ZoomSyncSettings {
  accountId: string;
  clientId: string;
  clientSecret: string;
  userEmail: string;            // DEPRECATED: Use userEmails instead
  userEmails: string;           // Comma-separated list of Zoom user emails whose recordings to sync
  transcriptFolder: string;     // default: "zoom-transcripts"
  syncIntervalMinutes: number;  // default: 30
  lastSyncTimestamp?: number;
  fetchRecordingTranscripts: boolean;    // Fetch transcripts from cloud recordings (default: true)
  fetchAICompanionTranscripts: boolean;  // Fetch transcripts from AI Companion (default: false)
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

/**
 * Zoom API response types for recordings endpoint
 */

export interface ZoomRecordingFile {
  id: string;
  meeting_id: string;
  recording_start: string;
  recording_end: string;
  file_type: string;
  file_extension: string;
  file_size: number;
  play_url: string;
  download_url: string;
  status: string;
  recording_type: string;
}

/**
 * Participant audio file entry from Zoom recording metadata.
 * Contains individual audio track for each participant.
 */
export interface ZoomParticipantAudioFile {
  id: string;
  recording_start: string;
  recording_end: string;
  file_name: string;        // e.g., "John Smith's audio.m4a"
  file_type: string;
  file_extension: string;
  file_size: number;
  download_url: string;
  status: string;
}

export interface ZoomRecording {
  uuid: string;
  id: number;
  account_id: string;
  host_id: string;
  topic: string;
  type: number;
  start_time: string;
  duration: number;
  total_size: number;
  recording_count: number;
  recording_files: ZoomRecordingFile[];
  participant_audio_files?: ZoomParticipantAudioFile[];
}

export interface ZoomListRecordingsResponse {
  from: string;
  to: string;
  page_size: number;
  total_records: number;
  next_page_token: string;
  meetings: ZoomRecording[];
}

/**
 * Zoom API response types for reports/meetings endpoint
 */
export interface ZoomPastMeeting {
  uuid: string;
  id: number;
  type: number;
  topic: string;
  user_name: string;
  user_email: string;
  start_time: string;
  end_time: string;
  duration: number;
  total_minutes: number;
  participants_count: number;
}

export interface ZoomListPastMeetingsResponse {
  from: string;
  to: string;
  page_size: number;
  total_records: number;
  next_page_token: string;
  meetings: ZoomPastMeeting[];
}

/**
 * Zoom API response for meeting transcript endpoint
 */
export interface ZoomMeetingTranscript {
  meeting_id: string;
  account_id: string;
  meeting_topic: string;
  host_id: string;
  transcript_created_time: string;
  can_download: boolean;
  auto_delete: boolean;
  download_url: string;
}

export interface ZoomMeetingTranscriptResponse {
  transcripts?: ZoomMeetingTranscript[];
}
