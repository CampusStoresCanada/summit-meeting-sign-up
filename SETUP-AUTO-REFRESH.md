# Automatic QuickBooks Token Refresh Setup

This system will automatically refresh your QuickBooks tokens every 50 minutes and update your Vercel environment variables, so you never have to manually refresh tokens again!

## 🔧 Setup Required

Add these environment variables to your Vercel project:

### 1. Get Vercel API Token
1. Go to https://vercel.com/account/tokens
2. Click "Create Token"
3. Name it "QB Token Refresh"
4. Copy the token

### 2. Get Project ID
1. Go to your Vercel project dashboard
2. Go to Settings → General
3. Copy the "Project ID"

### 3. Add Environment Variables
Add these to your Vercel project environment variables:

```
VERCEL_TOKEN=your_vercel_api_token_here
VERCEL_PROJECT_ID=your_project_id_here
```

## 🚀 How It Works

1. **Cron Job**: Runs every 50 minutes (10 minutes before tokens expire)
2. **Token Refresh**: Calls QuickBooks OAuth API to get fresh tokens
3. **Auto Update**: Updates `QBO_ACCESS_TOKEN` and `QBO_REFRESH_TOKEN` in Vercel automatically
4. **No Downtime**: Your app continues working without interruption

## 📋 API Endpoints

### `/api/auto-refresh-qb-tokens`
- **Method**: GET or POST
- **Purpose**: Refreshes tokens and updates Vercel env vars
- **Cron**: Runs automatically every 50 minutes
- **Manual**: You can also call this manually for testing

### Response Example:
```json
{
  "success": true,
  "message": "QuickBooks tokens refreshed successfully",
  "expires_in_hours": 1,
  "next_refresh_recommended": "2024-01-01T15:50:00.000Z",
  "vercel_update": {
    "success": true,
    "message": "Access Token: updated, Refresh Token: updated"
  }
}
```

## 🔍 Testing

1. **Test the endpoint manually**:
   ```
   curl -X POST https://your-app.vercel.app/api/auto-refresh-qb-tokens
   ```

2. **Check Vercel logs** to see the cron job running

3. **Monitor environment variables** to see them update automatically

## 🚨 Fallback

If automatic updates fail, the response will include `manual_instructions` with the tokens you need to update manually in Vercel.

## ⏰ Timeline

- **Access tokens**: Expire every 1 hour
- **Refresh tokens**: Expire every 101 days
- **Cron runs**: Every 50 minutes (10 min buffer)
- **If refresh token expires**: You'll need to re-authenticate via `qbo-oauth-helper.html`

No more hourly token refreshes! 🎉