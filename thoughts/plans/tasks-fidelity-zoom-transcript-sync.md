# Zoom Transcript Sync - Fidelity Implementation Tasks

## Implementation Authority

**Source Specification:** `thoughts/specs/spec-zoom-transcript-sync.md`
**Implementation Scope:** Exactly as specified, no additions or modifications

### Specification Summary

An Obsidian plugin that fetches completed meeting transcripts from the Zoom REST API on a configurable interval, stores them as Markdown files with YAML frontmatter metadata, and uses a local JSON state file to prevent duplicate syncing.

### Implementation Boundaries

**Included:**
- Zoom Server-to-Server OAuth authentication
- Automatic transcript sync on configurable interval
- Manual sync command
- VTT transcript parsing to Markdown
- YAML frontmatter with meeting metadata
- Collision prevention via file existence check + JSON state file
- Settings UI for credentials and configuration
- User notices for sync status/errors

**Excluded:**
- Real-time transcript streaming
- Transcript editing/modification
- Integration with other meeting platforms
- Custom transcript formatting beyond specification
- External npm packages (uses only Obsidian built-in APIs)

**Testing Level:** Unit tests for VTT parsing, frontmatter generation, sync state, OAuth caching; Integration tests with mocks; Manual testing with real Zoom account
**Security Level:** Credentials in Obsidian plugin data, no logging of credentials, HTTPS only, input sanitization for file names
**Documentation Level:** Documentation specified in Phase 4 (README.md for plugin usage)

## Implementation Files

```
src/
  main.ts              # Plugin entry point, lifecycle management
  settings.ts          # Settings interface and tab
  zoom-api.ts          # Zoom API client (auth, recordings, transcripts)
  sync-state.ts        # Sync state management (JSON file operations)
  transcript-writer.ts # Markdown file generation with frontmatter
  types.ts             # TypeScript interfaces

tests/
  vtt-parser.test.ts        # Unit tests for VTT parsing
  frontmatter.test.ts       # Unit tests for YAML frontmatter generation
  sync-state.test.ts        # Unit tests for sync state read/write
  oauth-caching.test.ts     # Unit tests for OAuth token caching
  zoom-api.test.ts          # Integration tests for ZoomApiClient
  sync-flow.test.ts         # Integration tests for full sync flow

# Config files
manifest.json         # Plugin manifest
versions.json         # Version compatibility
tsconfig.json         # TypeScript config (strict mode)
.eslintrc.js          # ESLint configuration
esbuild.config.mjs    # Build configuration
README.md             # Plugin documentation
```

### Development Notes

- Follow specification requirements exactly as written
- Do not add testing beyond what's specified
- Do not add security measures beyond what's specified
- Do not expand scope or "improve" requirements without user approval
- Question any ambiguity rather than assuming
- No external npm packages - use only Obsidian built-in APIs

### Approval & Clarification Protocol

**When implementing agents encounter any of the following, they MUST stop and ask for user approval:**

1. **Scope Adjustments** - Any addition, removal, or modification to specified requirements
2. **Ambiguity** - Specification is unclear about implementation details
3. **Contradictions** - Specification conflicts with existing code patterns or constraints
4. **Technical Blockers** - A specified approach is infeasible or would cause issues
5. **Missing Information** - Critical details needed to proceed are not in the specification
6. **Better Alternatives** - A clearly superior approach is discovered during implementation

**Process:**
1. **Stop** - Do not proceed with assumptions
2. **Report** - Explain what was discovered and its impact
3. **Present Options** - Offer alternatives with trade-offs if applicable
4. **Wait** - Get explicit user approval before continuing

## Implementation Phases

### Phase 1: Core Infrastructure

**Objective:** Plugin scaffold, settings interface, Zoom API client with OAuth, basic sync state management

**Specification Requirements:**
- Plugin scaffold based on obsidian-sample-plugin
- TypeScript strict mode for type safety (Quality Assurance)
- ESLint for code quality (Quality Assurance)
- Settings interface with Account ID, Client ID, Client Secret, Transcript Folder, Sync Interval
- Settings tab UI with password field for Client Secret
- Zoom OAuth token lifecycle (fetch, cache 1 hour, refresh on expiry)
- Grant type: `account_credentials`
- Token endpoint: `POST https://zoom.us/oauth/token`
- Sync state JSON file management with atomic writes

**Tasks:**

- [x] 1.0 Create Plugin Scaffold
  - [x] 1.1 Configure `manifest.json` with plugin ID `zoom-transcript-sync`, name, version, minAppVersion (0.15.0), and required fields
  - [x] 1.2 Configure `versions.json` mapping plugin version to minimum Obsidian version
  - [x] 1.3 Configure `tsconfig.json` with TypeScript strict mode enabled (per specification Quality Assurance)
  - [x] 1.4 Configure ESLint for code quality (per specification Quality Assurance)
  - [x] 1.5 Set up build system (esbuild) following obsidian-sample-plugin pattern
  - [x] 1.6 Create `src/types.ts` with `ZoomSyncSettings` and `SyncState` interfaces per specification
  - [x] 1.7 Create `src/main.ts` plugin entry point extending `Plugin` class with `onload()`, `loadSettings()`, `saveSettings()`
  - [x] 1.8 Create `src/settings.ts` with `ZoomSyncSettingTab` extending `PluginSettingTab`

- [x] 2.0 Implement Settings Interface
  - [x] 2.1 Add settings fields: accountId, clientId, clientSecret, transcriptFolder (default: "zoom-transcripts"), syncIntervalMinutes (default: 30)
  - [x] 2.2 Create settings tab UI with text inputs for Account ID, Client ID
  - [x] 2.3 Add password-type input for Client Secret
  - [x] 2.4 Add text input for Transcript Folder path
  - [x] 2.5 Add number input for Sync Interval (minutes)

- [x] 3.0 Implement Zoom API Client OAuth
  - [x] 3.1 Create `src/zoom-api.ts` with `ZoomApiClient` class
  - [x] 3.2 Implement `getAccessToken()` method with account_credentials grant type
  - [x] 3.3 Implement token caching (1 hour TTL, in-memory only)
  - [x] 3.4 Implement token refresh on expiry (no refresh tokens - request new)
  - [x] 3.5 Use Obsidian `requestUrl()` for all HTTP requests

- [x] 4.0 Implement Sync State Manager
  - [x] 4.1 Create `src/sync-state.ts` with `SyncStateManager` class
  - [x] 4.2 Implement `readState()` using `vault.adapter.read()` for `.zoom-sync-state.json`
  - [x] 4.3 Implement `writeState()` with atomic updates (write to temp file, then rename) per specification
  - [x] 4.4 Implement `isSynced(meetingId)` lookup method
  - [x] 4.5 Implement `markSynced(meetingId, fileName)` update method
  - [x] 4.6 State file location: `{transcriptFolder}/.zoom-sync-state.json`

### Phase 2: Sync Implementation

**Objective:** Recording list fetching with pagination, transcript download and VTT parsing, Markdown file generation with frontmatter, collision prevention

**Specification Requirements:**
- List recordings endpoint: `GET https://api.zoom.us/v2/users/me/recordings`
- Pagination support using `next_page_token`
- Transcript identified by `recording_type: "audio_transcript"` in files array
- VTT format parsing with speaker extraction
- YAML frontmatter with: meeting_name, meeting_time, meeting_duration, attendees, topic, host, recording_url, zoom_meeting_id, synced_at
- File existence check before writing (primary collision prevention)
- State file tracking (secondary efficiency optimization)

**Tasks:**

- [x] 5.0 Implement Recording List Fetching
  - [x] 5.1 Add `listRecordings()` method to ZoomApiClient
  - [x] 5.2 Implement pagination handling with `next_page_token`
  - [x] 5.3 Filter recordings to those with `recording_type: "audio_transcript"` in files array
  - [x] 5.4 Use `from` date parameter with `lastSyncTimestamp` to reduce API calls
  - [x] 5.5 Extract participant/attendee list from recording metadata (if available in API response)

- [ ] 6.0 Implement Transcript Download
  - [x] 6.1 Add `downloadTranscript(downloadUrl)` method to ZoomApiClient
  - [x] 6.2 Use `requestUrl()` to fetch VTT file content with access token authentication
  - [x] 6.3 Handle download errors with retry logic

- [ ] 7.0 Implement VTT Parser
  - [ ] 7.1 Create VTT parsing function in `src/transcript-writer.ts`
  - [ ] 7.2 Parse WebVTT format: timestamp lines `00:00:16.239 --> 00:00:27.079`
  - [ ] 7.3 Extract speaker names from dialogue lines: `Speaker Name: Dialogue text`
  - [ ] 7.4 Convert to readable format: `**00:00:16 - Speaker Name:**\nDialogue text`

- [ ] 8.0 Implement Transcript Writer
  - [ ] 8.1 Create `TranscriptWriter` class in `src/transcript-writer.ts`
  - [ ] 8.2 Implement YAML frontmatter generation with all specified fields
  - [ ] 8.3 Implement Markdown body generation with header, attendees section, transcript section
  - [ ] 8.4 Generate file name from sanitized meeting title (remove/replace unsafe characters for filesystem)
  - [ ] 8.5 Handle duplicate file names by appending meeting ID if collision detected
  - [ ] 8.6 Escape special characters in frontmatter values

- [ ] 9.0 Implement Collision Prevention
  - [ ] 9.1 Use `vault.getAbstractFileByPath()` to check file existence before creating
  - [ ] 9.2 Skip transcript if file already exists (primary deduplication)
  - [ ] 9.3 Check sync state for efficiency (secondary check, optional)
  - [ ] 9.4 Use `vault.createFolder()` to ensure transcript folder exists
  - [ ] 9.5 Use `vault.create()` to write new transcript files

### Phase 3: User Experience

**Objective:** Manual sync command, interval-based auto-sync, user notices, settings validation

**Specification Requirements:**
- Command: "Sync Zoom Transcripts Now" via Command Palette
- Auto-sync on configurable interval using `registerInterval()`
- Notices per specification table:
  - Sync complete (new): "Synced {n} new transcript(s)"
  - Sync complete (none): no notice
  - Auth error: "Zoom sync failed: invalid credentials. Check settings."
  - Network error: "Zoom sync failed: network error. Will retry."
  - Rate limited: "Zoom sync rate limited. Waiting before retry."
- Test Connection button in settings
- Sync Now button in settings
- Sync lock to prevent concurrent operations

**Tasks:**

- [ ] 10.0 Implement Sync Orchestrator
  - [ ] 10.1 Create `syncTranscripts()` method in main.ts
  - [ ] 10.2 Implement sync lock to prevent concurrent runs
  - [ ] 10.3 Coordinate: token fetch -> recording list -> download -> parse -> write -> update state
  - [ ] 10.4 Process one transcript at a time to limit memory usage

- [ ] 11.0 Implement Manual Sync Command
  - [ ] 11.1 Register command with `addCommand()`: id 'sync-now', name 'Sync Zoom Transcripts Now'
  - [ ] 11.2 Command callback triggers `syncTranscripts()`

- [ ] 12.0 Implement Auto-Sync Interval
  - [ ] 12.1 Use `registerInterval()` with `window.setInterval()`
  - [ ] 12.2 Interval from `settings.syncIntervalMinutes` converted to milliseconds
  - [ ] 12.3 Auto-cleanup on plugin unload (handled by registerInterval)

- [ ] 13.0 Implement User Notices
  - [ ] 13.1 Show "Synced {n} new transcript(s)" on successful sync with new transcripts
  - [ ] 13.2 No notice when sync completes with no new transcripts
  - [ ] 13.3 Show "Zoom sync failed: invalid credentials. Check settings." on auth errors
  - [ ] 13.4 Show "Zoom sync failed: network error. Will retry." on network errors
  - [ ] 13.5 Show "Zoom sync rate limited. Waiting before retry." on 429 responses

- [ ] 14.0 Implement Settings Buttons
  - [ ] 14.1 Add "Test Connection" button that validates credentials via OAuth token fetch
  - [ ] 14.2 Add "Sync Now" button that triggers manual sync

### Phase 4: Error Handling, Testing & Polish

**Objective:** Robust error handling, rate limiting, edge cases, unit tests, integration tests, documentation

**Specification Requirements:**
- Exponential backoff: Attempt 1 immediate, Attempt 2 wait 1s, Attempt 3 wait 3s, then skip
- Max 3 retry attempts per item
- Rate limiting: respect 429 responses, exponential backoff
- Auth errors: clear cached token, disable auto-sync, prompt user to verify credentials
- Partial failure: if one transcript fails, continue with others
- State corruption recovery: rebuild from file system (skip-if-exists as fallback)
- Console logging in dev mode only
- Unit tests: VTT parsing, frontmatter generation, sync state read/write, OAuth token caching
- Integration tests: Zoom API client with mocks, full sync flow with mock Vault
- Documentation for plugin usage

**Tasks:**

- [ ] 15.0 Implement Retry Logic
  - [ ] 15.1 Add exponential backoff function: immediate, 1s, 3s delays
  - [ ] 15.2 Implement max 3 retries per network operation
  - [ ] 15.3 Skip failed item after 3 failures, continue with others

- [ ] 16.0 Implement Rate Limit Handling
  - [ ] 16.1 Detect 429 response status
  - [ ] 16.2 Implement backoff on rate limit (respect Retry-After header if present)
  - [ ] 16.3 Show rate limit notice to user

- [ ] 17.0 Implement Auth Error Handling
  - [ ] 17.1 Detect authentication failures from API responses
  - [ ] 17.2 Clear cached access token on auth error
  - [ ] 17.3 Disable auto-sync on invalid credentials (per specification)
  - [ ] 17.4 Show credentials error notice prompting user to check settings

- [ ] 18.0 Implement Graceful Degradation
  - [ ] 18.1 Continue sync if individual transcript fails
  - [ ] 18.2 Console logging in dev mode only: sync start/end timestamps, recordings fetched count, transcripts created/skipped, errors with context
  - [ ] 18.3 Report partial success in completion notice

- [ ] 19.0 Set Up Test Environment
  - [ ] 19.1 Configure test runner (Jest or Vitest) for TypeScript
  - [ ] 19.2 Set up mock utilities for Obsidian Vault API
  - [ ] 19.3 Set up mock utilities for HTTP requests (requestUrl)

- [ ] 20.0 Implement Unit Tests
  - [ ] 20.1 Write unit tests for VTT parsing logic (various VTT formats, edge cases)
  - [ ] 20.2 Write unit tests for YAML frontmatter generation
  - [ ] 20.3 Write unit tests for sync state read/write operations
  - [ ] 20.4 Write unit tests for OAuth token caching logic (expiry, refresh)

- [ ] 21.0 Implement Integration Tests
  - [ ] 21.1 Write integration tests for ZoomApiClient with mock HTTP responses
  - [ ] 21.2 Write integration tests for full sync flow with mock Vault
  - [ ] 21.3 Test with various transcript sizes (per Quality Assurance)
  - [ ] 21.4 Test pagination with many recordings (per Quality Assurance)
  - [ ] 21.5 Test error recovery scenarios (per Quality Assurance)

- [ ] 22.0 Create Documentation
  - [ ] 22.1 Create README.md with plugin overview, features, and requirements
  - [ ] 22.2 Document Zoom API setup instructions (Server-to-Server OAuth app creation)
  - [ ] 22.3 Document plugin configuration and usage

- [ ] 23.0 Final Validation
  - [ ] 23.1 Verify all specification success criteria met
  - [ ] 23.2 Test collision prevention with existing files
  - [ ] 23.3 Test sync state tracking
  - [ ] 23.4 Verify frontmatter contains all specified fields
  - [ ] 23.5 Run all unit and integration tests

## Specification Context

### Zoom API Details

**Authentication:**
- Token endpoint: `POST https://zoom.us/oauth/token`
- Grant type: `account_credentials`
- Required credentials: Account ID, Client ID, Client Secret
- Access tokens expire after 1 hour (3600 seconds)
- No refresh tokens - request new token when expired

**Required API Scopes:**
- `recording:read:admin` (minimum required)

**API Endpoints:**
1. List recordings: `GET https://api.zoom.us/v2/users/me/recordings`
2. Get recording details: `GET https://api.zoom.us/v2/meetings/{meetingId}/recordings`

**Transcript Format (VTT):**
```
WEBVTT

1
00:00:16.239 --> 00:00:27.079
Speaker Name: Dialogue text
```

**Implementation Notes:**
- Download URLs require access token authentication (Bearer token or query param)
- Attendees may be available in recording metadata as `participant_audio_files` or from meeting details endpoint
- If attendees unavailable from API, extract unique speaker names from VTT content as fallback

### Obsidian Plugin APIs

```typescript
// HTTP requests (bypasses CORS)
requestUrl(options: RequestUrlParam): Promise<RequestUrlResponse>

// File operations
vault.create(path: string, data: string): Promise<TFile>
vault.createFolder(path: string): Promise<TFolder>
vault.getAbstractFileByPath(path: string): TAbstractFile | null

// State file operations
vault.adapter.read(path: string): Promise<string>
vault.adapter.write(path: string, data: string): Promise<void>

// Plugin data persistence
loadData(): Promise<any>
saveData(data: any): Promise<void>

// Periodic tasks
registerInterval(id: number): number

// Commands
addCommand(command: Command): Command

// Settings
addSettingTab(settingTab: SettingTab): void
```

### Data Schemas

**Settings Interface:**
```typescript
interface ZoomSyncSettings {
  accountId: string;
  clientId: string;
  clientSecret: string;
  transcriptFolder: string;     // default: "zoom-transcripts"
  syncIntervalMinutes: number;  // default: 30
  lastSyncTimestamp?: number;
}
```

**Sync State Schema:**
```typescript
interface SyncState {
  version: 1;
  syncedMeetings: {
    [meetingId: string]: {
      syncedAt: number;
      fileName: string;
    };
  };
}
```

### Transcript File Format

```markdown
---
meeting_name: "Weekly Team Standup"
meeting_time: 2025-12-10T10:00:00Z
meeting_duration: 45
attendees:
  - Alice Smith
  - Bob Johnson
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

## Transcript

**00:00:16 - Alice Smith:**
Good morning everyone, let's get started.

**00:00:22 - Bob Johnson:**
Morning! I'll go first...
```

## Implementation Requirements

### Fidelity Requirements (MANDATORY)

- Implement ONLY what's explicitly specified
- Do not add features, tests, or security beyond specification
- Question ambiguities rather than making assumptions
- Preserve all specification constraints and limitations
- No external npm packages - use only Obsidian built-in APIs

### Success Criteria (from specification)

1. Transcripts sync automatically on configured interval
2. No duplicate transcript files created across multiple users
3. Comprehensive metadata extracted into YAML frontmatter
4. Manual sync command available
5. Settings UI for all configuration options

### Performance Requirements (from specification)

| Metric | Target |
|--------|--------|
| Sync completion | < 30 seconds for 10 transcripts |
| Memory usage | < 50MB during sync |
| UI responsiveness | No blocking during sync |

### Security Requirements (from specification)

- Store credentials in Obsidian's plugin data (local storage)
- Never log credentials to console
- Never include credentials in sync state or transcript files
- Credentials only transmitted to Zoom OAuth endpoint over HTTPS
- All API calls over HTTPS
- Sanitize meeting titles for file names
- Validate API responses before processing
- Escape special characters in frontmatter

## Validation Checklist

- [ ] Implementation matches specification exactly
- [ ] No scope additions or "improvements" made
- [ ] All specification constraints preserved
- [ ] Success criteria from specification met
- [ ] Unit tests implemented as specified (VTT parsing, frontmatter, sync state, OAuth caching)
- [ ] Integration tests implemented as specified (API client mocks, sync flow mocks)
- [ ] Documentation (README.md) created as specified in Phase 4
- [ ] No security measures beyond specification requirements
- [ ] No external npm packages used

## Completion Criteria

From specification:

1. **Functional:** Plugin fetches and stores transcripts from Zoom API
2. **Reliable:** No duplicate transcripts created, even with multiple users
3. **Configurable:** Users can set sync interval, folder location, and credentials
4. **Usable:** Settings UI is intuitive; manual sync command available
5. **Metadata-rich:** Frontmatter includes all specified fields (meeting name, time, attendees, duration, topic, recording links, host info)
