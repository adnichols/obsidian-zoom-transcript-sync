# Zoom Transcript Sync - Research Specification

## Executive Summary

### Problem
Users need to automatically sync Zoom meeting transcripts to a shared Obsidian vault with collision prevention when multiple users access the same vault.

### Solution
An Obsidian plugin that fetches completed meeting transcripts from the Zoom REST API on a configurable interval, stores them as Markdown files with YAML frontmatter metadata, and uses a local JSON state file to prevent duplicate syncing.

### Value
- Automatic transcript archival without manual download/upload
- Structured metadata for downstream processing and search
- Multi-user safe syncing for shared vaults

### Success Criteria
- Transcripts sync automatically on configured interval
- No duplicate transcript files created across multiple users
- Comprehensive metadata extracted into YAML frontmatter
- Manual sync command available
- Settings UI for all configuration options

## Core Research Findings

### Technical Approach

#### Zoom REST API Integration

Based on research from [Recall.ai](https://www.recall.ai/blog/zoom-transcript-api) and [AssemblyAI](https://www.assemblyai.com/blog/zoom-transcription-zoom-api):

**Authentication: Server-to-Server OAuth**
- Token endpoint: `POST https://zoom.us/oauth/token`
- Grant type: `account_credentials`
- Required credentials: Account ID, Client ID, Client Secret
- Access tokens expire after 1 hour (3600 seconds)
- No refresh tokens - request new token when expired

**Required API Scopes:**
- `recording:read:admin` (minimum required)
- Alternative: `cloud_recording:read:list_user_recordings:admin` + `cloud_recording:read:list_recording_files:admin`

**API Endpoints:**
1. List recordings: `GET https://api.zoom.us/v2/users/me/recordings`
2. Get recording details: `GET https://api.zoom.us/v2/meetings/{meetingId}/recordings`

**Transcript Format:**
- Transcripts returned as VTT (WebVTT) format
- File identified by `recording_type: "audio_transcript"` in recording files array
- Each file has a `download_url` for retrieval
- VTT structure:
  ```
  WEBVTT

  1
  00:00:16.239 --> 00:00:27.079
  Speaker Name: Dialogue text
  ```

**Critical Limitations:**
- Paid Zoom plan required (Pro, Business, Enterprise)
- Cloud Recording must be enabled (not local recording)
- Audio transcript feature must be manually enabled in Zoom settings
- Processing delay: ~2x meeting duration (up to 24 hours)
- English only for Zoom's native transcription

#### Obsidian Plugin Architecture

Based on the [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) and [Obsidian API](https://github.com/obsidianmd/obsidian-api):

**Core APIs:**
```typescript
// HTTP requests (bypasses CORS)
requestUrl(options: RequestUrlParam): Promise<RequestUrlResponse>

// File operations
vault.create(path: string, data: string): Promise<TFile>
vault.createFolder(path: string): Promise<TFolder>
vault.read(file: TFile): Promise<string>
vault.modify(file: TFile, data: string): Promise<void>
vault.getAbstractFileByPath(path: string): TAbstractFile | null

// Plugin data persistence
loadData(): Promise<any>
saveData(data: any): Promise<void>

// Periodic tasks
registerInterval(id: number): number  // auto-cleanup on unload

// Commands
addCommand(command: Command): Command

// Settings
addSettingTab(settingTab: SettingTab): void
```

**Plugin Structure Pattern:**
```typescript
export default class ZoomTranscriptSync extends Plugin {
  settings: ZoomSyncSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ZoomSyncSettingTab(this.app, this));
    this.addCommand({ id: 'sync-now', name: 'Sync Zoom Transcripts Now', callback: () => this.syncTranscripts() });
    this.registerInterval(window.setInterval(() => this.syncTranscripts(), this.settings.syncInterval));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

### Integration Points

**Vault File System:**
- Use `vault.create()` for new transcript files
- Use `vault.createFolder()` to ensure transcript folder exists
- Check file existence with `vault.getAbstractFileByPath()` before creating

**Sync State Management:**
- Store `.zoom-sync-state.json` in the transcript folder
- Use `vault.adapter.read()` and `vault.adapter.write()` for JSON file operations
- State file tracks synced meeting IDs and timestamps

**Collision Prevention:**
- Check if transcript file already exists before writing
- If file exists, skip that transcript (file-based deduplication)
- State file provides secondary tracking for efficiency

### Performance Considerations

**API Rate Limiting:**
- Zoom API has rate limits (varies by plan)
- Implement exponential backoff on 429 responses
- Cache access token for 1 hour (until expiry)

**Sync Efficiency:**
- Track last sync timestamp to reduce API calls
- Use pagination for large recording lists (`next_page_token`)
- Process recordings in batches to avoid blocking UI

**Memory Management:**
- Stream large transcript downloads if possible
- Process one transcript at a time to limit memory usage

## Problem & Solution

### Core Problem

Teams using Obsidian as a shared knowledge base need to archive Zoom meeting transcripts for reference, search, and downstream processing (e.g., AI summarization, action item extraction). Currently, this requires:
1. Manually downloading transcripts from Zoom
2. Manually formatting with metadata
3. Manually uploading to shared vault
4. Coordinating to avoid duplicate uploads

This is error-prone, time-consuming, and doesn't scale.

### Target Users

**Primary User:** Team members using a shared Obsidian vault who regularly participate in Zoom meetings.

**User Characteristics:**
- Have access to Zoom account with cloud recording enabled
- Use Obsidian for knowledge management
- Share vault via Obsidian Sync, git, or cloud storage
- Want automated transcript archival

**Use Cases:**
1. **Automatic archival:** Transcripts appear in vault after meetings without manual intervention
2. **Search and reference:** Find past meeting content via Obsidian search
3. **Downstream processing:** Other plugins/scripts can process transcripts in the designated folder
4. **Team collaboration:** Multiple team members can rely on same transcript archive

### Success Criteria

1. **Functional:** Plugin fetches and stores transcripts from Zoom API
2. **Reliable:** No duplicate transcripts created, even with multiple users
3. **Configurable:** Users can set sync interval, folder location, and credentials
4. **Usable:** Settings UI is intuitive; manual sync command available
5. **Metadata-rich:** Frontmatter includes all specified fields (meeting name, time, attendees, duration, topic, recording links, host info)

## Technical Design

### Implementation Strategy

#### Module Structure

```
src/
  main.ts              # Plugin entry point, lifecycle management
  settings.ts          # Settings interface and tab
  zoom-api.ts          # Zoom API client (auth, recordings, transcripts)
  sync-state.ts        # Sync state management (JSON file operations)
  transcript-writer.ts # Markdown file generation with frontmatter
  types.ts             # TypeScript interfaces
```

#### Core Components

**1. ZoomApiClient**
- Manages OAuth token lifecycle (fetch, cache, refresh)
- Fetches recording list with pagination
- Downloads transcript files
- Handles rate limiting with exponential backoff

**2. SyncStateManager**
- Reads/writes `.zoom-sync-state.json` from transcript folder
- Tracks synced meeting IDs with timestamps
- Provides efficient lookup for already-synced transcripts

**3. TranscriptWriter**
- Parses VTT content into readable transcript format
- Generates YAML frontmatter from recording metadata
- Creates Markdown files via Vault API

**4. SyncOrchestrator (main.ts)**
- Coordinates sync process
- Manages interval scheduling
- Handles errors and provides user feedback via Notice

#### Sync Process Flow

```
1. Check if sync already in progress (prevent concurrent runs)
2. Fetch/refresh Zoom access token
3. Fetch recording list from Zoom API (paginated)
4. For each recording with transcript:
   a. Check if file already exists in vault (skip if exists)
   b. Check sync state for efficiency (optional secondary check)
   c. Download transcript VTT file
   d. Parse VTT and extract speaker segments
   e. Extract metadata from recording object
   f. Generate Markdown with YAML frontmatter
   g. Create file in transcript folder
   h. Update sync state
5. Save updated sync state
6. Show completion Notice
```

### Data Requirements

#### Settings Interface

```typescript
interface ZoomSyncSettings {
  // Zoom API Credentials
  accountId: string;
  clientId: string;
  clientSecret: string;

  // Sync Configuration
  transcriptFolder: string;     // default: "zoom-transcripts"
  syncIntervalMinutes: number;  // default: 30

  // State (internal)
  lastSyncTimestamp?: number;
}
```

#### Sync State Schema

```typescript
interface SyncState {
  version: 1;
  syncedMeetings: {
    [meetingId: string]: {
      syncedAt: number;       // Unix timestamp
      fileName: string;       // Relative path in vault
    };
  };
}
```

File: `{transcriptFolder}/.zoom-sync-state.json`

#### Transcript File Format

```markdown
---
meeting_name: "Weekly Team Standup"
meeting_time: 2025-12-10T10:00:00Z
meeting_duration: 45
attendees:
  - Alice Smith
  - Bob Johnson
  - Carol Williams
topic: "Q4 Planning Discussion"
host: "Alice Smith"
recording_url: "https://zoom.us/rec/share/..."
zoom_meeting_id: "123456789"
synced_at: 2025-12-10T12:30:00Z
---

# Weekly Team Standup

**Date:** December 10, 2025
**Duration:** 45 minutes
**Host:** Alice Smith

## Attendees
- Alice Smith
- Bob Johnson
- Carol Williams

## Transcript

**00:00:16 - Alice Smith:**
Good morning everyone, let's get started with our standup.

**00:00:22 - Bob Johnson:**
Morning! I'll go first...

[... rest of transcript ...]
```

### Security & Reliability

#### Credential Security
- Store credentials in Obsidian's plugin data (uses local storage)
- Never log credentials to console
- Never include credentials in sync state or transcript files
- Credentials only transmitted to Zoom OAuth endpoint over HTTPS

#### Error Handling
- Network errors: Retry with exponential backoff (max 3 attempts)
- Auth errors: Clear cached token, prompt user to verify credentials
- Rate limiting: Respect 429 responses, wait before retry
- API errors: Log error, skip failed transcript, continue with others
- File errors: Log error, notify user, continue sync

#### Reliability Features
- Atomic sync state updates (write to temp file, then rename)
- Skip-if-exists prevents duplicate files even if state is corrupted
- Sync lock prevents concurrent sync operations
- Graceful degradation on partial failures

## User Interface

### User Flow

1. **Initial Setup:**
   - User installs plugin
   - Opens Settings > Zoom Transcript Sync
   - Enters Zoom API credentials (Account ID, Client ID, Client Secret)
   - Optionally adjusts transcript folder and sync interval
   - Saves settings

2. **Ongoing Usage:**
   - Plugin automatically syncs on configured interval
   - User can trigger manual sync via Command Palette: "Sync Zoom Transcripts Now"
   - New transcripts appear in configured folder
   - User receives Notice on sync completion

3. **Error States:**
   - Invalid credentials: Notice prompts user to check settings
   - Network error: Notice indicates temporary failure, will retry
   - No new transcripts: Silent (no Notice to avoid noise)

### Interface Needs

#### Settings Tab

```
Zoom Transcript Sync Settings
─────────────────────────────

Zoom API Credentials
  Account ID      [________________]
  Client ID       [________________]
  Client Secret   [________________]  (password field)

Sync Configuration
  Transcript Folder  [zoom-transcripts__]
  Sync Interval      [30] minutes

[Test Connection]  [Sync Now]
```

#### Commands

| Command | Description |
|---------|-------------|
| Sync Zoom Transcripts Now | Trigger immediate sync |

#### Notices

| Event | Notice Text |
|-------|-------------|
| Sync complete (new) | "Synced {n} new transcript(s)" |
| Sync complete (none) | (no notice) |
| Auth error | "Zoom sync failed: invalid credentials. Check settings." |
| Network error | "Zoom sync failed: network error. Will retry." |
| Rate limited | "Zoom sync rate limited. Waiting before retry." |

## Testing Approach

### Test Strategy

**Unit Tests:**
- VTT parsing logic
- Frontmatter generation
- Sync state read/write
- OAuth token caching logic

**Integration Tests:**
- Zoom API client with mock responses
- Full sync flow with mock Vault

**Manual Testing:**
- Real Zoom account integration
- Multi-user collision testing
- Long-running interval testing

### Quality Assurance

- TypeScript strict mode for type safety
- ESLint for code quality
- Test with various transcript sizes
- Test pagination with many recordings
- Test error recovery scenarios

## Performance & Reliability

### Performance Requirements

| Metric | Target |
|--------|--------|
| Sync completion | < 30 seconds for 10 transcripts |
| Memory usage | < 50MB during sync |
| UI responsiveness | No blocking during sync |

### Error Handling

**Retry Strategy:**
```
Attempt 1: Immediate
Attempt 2: Wait 1 second
Attempt 3: Wait 3 seconds
After 3 failures: Skip item, continue with others
```

**Graceful Degradation:**
- If one transcript fails, continue with others
- If state file corrupted, rebuild from file system
- If credentials invalid, disable auto-sync, prompt user

### Monitoring & Observability

**Console Logging (dev mode only):**
- Sync start/end timestamps
- Number of recordings fetched
- Transcripts created/skipped
- Errors with context

**User-Facing Status:**
- Notices for significant events
- Optional status bar indicator during sync

## Security & Compliance

### Security Architecture

**Authentication:**
- Server-to-Server OAuth (no user browser flow)
- Credentials stored in Obsidian plugin data
- Access tokens cached in memory only (1 hour TTL)

**Data Protection:**
- All API calls over HTTPS
- Transcript content stored locally in vault
- No data sent to third parties

**Input Validation:**
- Sanitize meeting titles for file names
- Validate API responses before processing
- Escape special characters in frontmatter

### Compliance Requirements

**Zoom API Terms:**
- Follow Zoom's API usage guidelines
- Respect rate limits
- Use appropriate scopes (minimum required)

**Data Handling:**
- Transcripts may contain sensitive content
- Users responsible for vault access controls
- Plugin does not transmit transcript content externally

## Compatibility & Migration

### Backward Compatibility

Not applicable - new plugin with no prior versions.

### Integration Requirements

**Obsidian Version:**
- Minimum: 0.15.0 (per sample plugin)
- Desktop and mobile support (if requestUrl works on mobile)

**Zoom Requirements:**
- Paid Zoom plan (Pro, Business, Enterprise)
- Cloud Recording enabled
- Audio transcript feature enabled
- Server-to-Server OAuth app created

**External Dependencies:**
- No external npm packages required
- Uses only Obsidian built-in APIs

## Implementation Plan

### Development Phases

**Phase 1: Core Infrastructure**
- Plugin scaffold based on sample-plugin
- Settings interface and tab
- Zoom API client with OAuth
- Basic sync state management

**Phase 2: Sync Implementation**
- Recording list fetching with pagination
- Transcript download and VTT parsing
- Markdown file generation with frontmatter
- File existence check (collision prevention)

**Phase 3: User Experience**
- Manual sync command
- Interval-based auto-sync
- User notices for status/errors
- Settings validation and test connection

**Phase 4: Polish & Testing**
- Error handling refinement
- Edge case handling
- Documentation
- Manual testing with real Zoom account

### Key Dependencies

**Technical:**
- Zoom Server-to-Server OAuth app with recording:read:admin scope
- Obsidian API for file operations and HTTP requests
- TypeScript for type safety

**User Requirements:**
- Zoom paid plan with cloud recording
- Audio transcript feature enabled in Zoom
- Vault sync mechanism for multi-user access (Obsidian Sync, git, etc.)

### Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Zoom API changes | Low | High | Monitor Zoom changelog, version API calls |
| Rate limiting issues | Medium | Medium | Implement backoff, respect limits |
| Transcript processing delay | High | Low | Document 2x duration delay for users |
| Multi-user state corruption | Low | Medium | File-based dedup as primary, state as optimization |
| Mobile compatibility | Medium | Low | Test on mobile, may be desktop-only |

## Research References

### Technical References

**Zoom API:**
- [Zoom Cloud Recording API Tutorial](https://www.recall.ai/blog/zoom-transcript-api) - Detailed implementation guide
- [Zoom Transcription via API](https://www.assemblyai.com/blog/zoom-transcription-zoom-api) - Authentication and code examples
- [Server-to-Server OAuth](https://developers.zoom.us/docs/internal-apps/s2s-oauth/) - Official auth documentation
- [Zoom API Reference](https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/) - Endpoint documentation

**Obsidian Plugin Development:**
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) - Official template
- [Obsidian API](https://github.com/obsidianmd/obsidian-api) - TypeScript definitions
- [Obsidian Developer Documentation](https://docs.obsidian.md/Home) - Official docs
- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) - Community plugin requirements

### Standards & Best Practices

- OAuth 2.0 account_credentials grant type
- WebVTT format specification for transcript parsing
- YAML frontmatter for Obsidian metadata
- TypeScript strict mode for plugin development

## Specification Complete

This specification contains all necessary information for task generation and implementation. It captures:

- Exact requirements from the PRD
- Technical research on Zoom API and Obsidian plugin patterns
- User decisions on sync state location, collision handling, and historical fetch
- Detailed implementation architecture
- Clear scope boundaries

Ready for fidelity-preserving implementation using developer-fidelity and quality-reviewer-fidelity agents.
