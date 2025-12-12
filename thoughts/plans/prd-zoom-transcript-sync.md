---
version: 1
fidelity_mode: strict
agents:
  developer: developer-fidelity
  reviewer: quality-reviewer-fidelity
scope_preservation: true
additions_allowed: none
document_metadata:
  source_type: user_requirements
  creation_date: 2025-12-12
  fidelity_level: absolute
  scope_changes: none
---

# Zoom Transcript Sync - Product Requirements Document

## Problem Statement

Users need an Obsidian plugin that automatically syncs Zoom meeting transcripts to a shared Obsidian vault, with proper handling of sync state to prevent collisions when multiple users access the same vault.

## Explicit Requirements

### Core Functionality

1. **Fetch transcripts from Zoom REST API** on a configurable recurring interval
2. **Store sync state in a local JSON file** within the vault to track which transcripts have been synced and prevent duplicate syncing across multiple users
3. **Store transcripts in a dedicated folder** (`zoom-transcripts/` or configurable) for downstream processing
4. **Extract comprehensive metadata** from transcripts and store as YAML frontmatter:
   - Meeting Name
   - Meeting Time
   - Attendees list
   - Meeting Duration
   - Topic
   - Recording links (if available)
   - Host information
   - Any other available Zoom metadata

### Plugin Configuration

1. **Zoom API credentials** configured via plugin settings:
   - Client ID
   - Client Secret
   - Account ID
2. **Configurable sync interval** (e.g., 5/15/30/60 minutes)
3. **Configurable transcript storage folder**

### File Format

- Markdown files (`.md`) with YAML frontmatter for metadata
- Transcript content in the document body

### Sync Collision Prevention

- Local JSON file tracks sync state (which transcripts have been synced, timestamps, etc.)
- Multiple users sharing the same vault should not create duplicate transcripts
- Handle potential conflicts when multiple users attempt to sync simultaneously

## Scope Boundaries

### Explicitly Included

- Obsidian plugin structure based on `obsidian-sample-plugin` template
- Zoom REST API integration for fetching completed meeting transcripts
- Configurable recurring sync via `registerInterval`
- Plugin settings tab for API credentials and sync configuration
- Sync state management via local JSON file in vault
- Markdown file generation with YAML frontmatter metadata
- Dedicated folder for transcript storage
- Commands for manual sync trigger
- Comprehensive metadata extraction (meeting name, time, attendees, duration, topic, recording links, host info)

### Explicitly Excluded

- Zoom RTMS SDK real-time WebSocket integration (requires external server)
- External database for sync state coordination
- OAuth browser flow authentication
- Backend server component
- Real-time transcript streaming
- Video/audio file handling
- Chat message syncing (unless included in transcript data)
- Transcript editing or modification features
- Integration with other meeting platforms

### Assumptions & Clarifications

- Users will create a Zoom Server-to-Server OAuth app or JWT app to obtain API credentials
- The Zoom account has cloud recording with transcription enabled
- Users have appropriate Zoom API scopes for accessing transcript data
- The shared vault is synced via an external mechanism (e.g., Obsidian Sync, git, cloud storage)
- Transcript files are intended for processing by other tools/workflows after syncing

## Success Criteria

- Plugin successfully fetches transcripts from Zoom REST API using configured credentials
- Transcripts are stored as Markdown files with complete YAML frontmatter metadata
- Sync state is tracked in a local JSON file within the vault
- Multiple users sharing a vault do not create duplicate transcript files
- Configurable sync interval works correctly with Obsidian's `registerInterval`
- Settings tab allows configuration of all required options
- Manual sync command is available

## Testing Requirements

Testing scope: To be determined during implementation phase

## Security Requirements

- API credentials stored securely in Obsidian's plugin data storage
- Credentials not exposed in sync state file or transcript files
- No credentials logged to console in production

## Technical Considerations

- Use Obsidian's `requestUrl` for HTTP requests to Zoom API
- Leverage `registerInterval` for recurring sync scheduling
- Use `loadData`/`saveData` for persistent settings and sync state storage
- Follow Obsidian plugin patterns from sample-plugin reference
- Handle API rate limits appropriately

### Reference Implementation Patterns

From `obsidian-sample-plugin`:
- Plugin class extending `Plugin`
- Settings interface and default settings pattern
- `loadSettings`/`saveSettings` methods
- `PluginSettingTab` for configuration UI
- `registerInterval` for periodic tasks
- `addCommand` for manual triggers

### Zoom REST API Endpoints (to be confirmed during implementation)

- Cloud recording list: `GET /users/{userId}/recordings`
- Recording details including transcript: `GET /meetings/{meetingId}/recordings`
- Transcript download endpoint

## Implementation Notes

### Fidelity Requirements (MANDATORY)

- Implement ONLY what's explicitly specified in this PRD
- Do not add features, tests, or security beyond requirements
- Question ambiguities rather than making assumptions
- Preserve all requirement constraints and limitations

### Next Steps

- Use developer-fidelity agent for implementation planning
- Use quality-reviewer-fidelity agent for validation
- Follow strict scope preservation throughout implementation

## Open Questions

1. **Zoom API scopes required**: Confirm exact scopes needed for transcript access (likely `recording:read` or similar)
2. **Transcript format from API**: Confirm the exact format Zoom returns transcripts in (VTT, SRT, JSON, plain text)
3. **Sync state file location**: Should the JSON sync state file be in the transcript folder or a hidden plugin folder?
4. **Collision handling strategy**: When two users sync simultaneously, should the second one skip or wait? What's the locking mechanism?
5. **Historical transcript fetch**: Should the initial sync fetch all historical transcripts or only new ones from the sync start date?

## Document Status

**PRD Complete:** This document captures the exact requirements as specified. Ready for fidelity-preserving implementation.
