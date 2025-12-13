---
date: 2025-12-13T00:03:45Z
researcher: Claude
git_commit: 2f9ff85047e51ea6fafb6a2de83876043f16ed74
branch: main
repository: obsidian_zoom_transcripts
topic: "Zoom Transcript Sync OAuth Debugging"
tags: [debugging, oauth, zoom-api, obsidian-plugin]
status: in_progress
last_updated: 2025-12-12
last_updated_by: Claude
type: debugging_session
---

# Handoff: Zoom Transcript Sync OAuth & API Debugging

## Task(s)

**Status: In Progress**

Debugging OAuth and API issues with the Zoom Transcript Sync Obsidian plugin. The plugin was built previously and released via GitHub/BRAT.

### Issues Resolved:
1. **OAuth 400 Error** - Fixed by changing from body params to query string params for token endpoint
2. **`users/me` not working with S2S OAuth** - Fixed by adding required `userEmail` setting and using `/users/{email}/recordings` endpoint
3. **Missing scope error** - User added `cloud_recording:read:list_user_recordings:admin` scope to their Zoom app
4. **Date filter too restrictive** - Fixed by defaulting to 6 months lookback instead of current month only

### Current Issue:
API returns 200 OK but **0 recordings** even though user confirms recordings exist in their account. Latest version (1.0.9) logs the full API response for debugging.

## Critical References
- `src/zoom-api.ts` - Main API client with OAuth and recordings logic
- `src/settings.ts` - Settings UI including new "Reset & Sync All" button
- `src/types.ts` - Type definitions including `ZoomSyncSettings` with `userEmail` field

## Recent changes

Key changes made during this debugging session:

- `src/zoom-api.ts:153-222` - Added debug logging to OAuth token fetch
- `src/zoom-api.ts:271-290` - Changed from `users/me` to `users/{email}/recordings`, added 6-month default lookback
- `src/zoom-api.ts:312-325` - Added `throw: false` to capture error response bodies, added full response logging
- `src/settings.ts:122-134` - Added "Full Re-sync" button to clear lastSyncTimestamp
- `src/types.ts:5` - Added `userEmail` field to `ZoomSyncSettings`

## Learnings

1. **S2S OAuth cannot use `users/me`** - Server-to-Server OAuth apps have no "logged in user" concept. Must specify actual user email/ID in the API path.

2. **Zoom API date filtering** - Without a `from` parameter, Zoom only returns recordings from the current month. Must explicitly specify `from` date to get older recordings. Max lookback is 6 months.

3. **Zoom scopes are granular** - `cloud_recording:read:recording:admin` is NOT the same as `cloud_recording:read:list_user_recordings:admin`. The latter is specifically needed to list recordings.

4. **Obsidian requestUrl throws on non-2xx** - Use `throw: false` option to get the actual error response body for better debugging.

5. **OAuth token URL format** - Query string params work better than body params for Zoom's OAuth endpoint per developer forum solutions.

## Artifacts

- `src/zoom-api.ts` - Updated with debug logging, S2S OAuth fix, 6-month lookback
- `src/settings.ts` - Added Full Re-sync button
- `src/types.ts` - Added userEmail setting
- `src/main.ts` - Added userEmail default
- GitHub releases v1.0.2 through v1.0.9 at https://github.com/adnichols/obsidian-zoom-transcript-sync/releases

## Action Items & Next Steps

1. **Wait for user to test v1.0.9** - They need to update via BRAT and click "Reset & Sync All"

2. **Analyze full API response** - The `[ZoomSync] Full API response:` log will show:
   - The `from` and `to` date range Zoom is searching
   - Total records count
   - Any pagination info

3. **Potential issues to investigate if still 0 recordings**:
   - Recordings might be under a different user email in the Zoom account
   - User might not be the host of the meetings (S2S might only see recordings where they were host)
   - Recordings might be local recordings, not cloud recordings
   - Account might not have cloud recording enabled
   - Might need additional scopes for cross-user access

4. **Consider adding** - A way to test with a specific user ID instead of email (Zoom sometimes requires the internal user ID)

## Other Notes

### User's Zoom App Configuration:
- Account ID: `2Z4OwOoiQQOvOm-Zqg3lcQ`
- Client ID starts with: `w6JP...`
- User email: `aaron@nodaste.com`
- Scopes configured:
  - `cloud_recording:read:recording:admin`
  - `cloud_recording:read:meeting_transcript:admin`
  - `cloud_recording:read:list_user_recordings:admin` (added during debugging)

### Version History (this session):
- v1.0.2 - OAuth query string fix
- v1.0.3 - OAuth debug logging
- v1.0.4 - listRecordings debug logging
- v1.0.5 - Added userEmail setting, fixed S2S OAuth user requirement
- v1.0.6 - Improved error logging
- v1.0.7 - Use throw:false to capture error body
- v1.0.8 - Added Full Re-sync button
- v1.0.9 - Default to 6 months lookback, log full API response

### Debug output to look for:
```
[ZoomSync] Full API response: {
  "from": "...",
  "to": "...",
  "total_records": ...,
  "meetings": [...]
}
```

If `total_records` is 0 and date range looks correct, the issue is likely with which user's recordings are being queried or account permissions.
