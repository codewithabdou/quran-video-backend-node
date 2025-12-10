# Pexels Videos Cache

This file caches Pexels video data to minimize API calls and avoid rate limits.

## How It Works

1. **First Request**: Fetches videos from Pexels API and saves to this file
2. **Subsequent Requests**: Serves data from this file (no API call)
3. **On Error**: Falls back to cache if API fails

## Cache Structure

```json
{
  "videos": [...],
  "cachedAt": "ISO timestamp",
  "count": 6
}
```

## Regenerating Cache

To fetch fresh data from Pexels:
1. Delete this file
2. Restart backend
3. Make a request to `/api/v1/backgrounds`

The cache will be automatically regenerated.
