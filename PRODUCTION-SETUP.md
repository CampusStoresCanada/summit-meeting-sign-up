# Production QuickBooks Online Setup Guide

This guide walks you through switching from QuickBooks Sandbox to Production environment.

## Overview

To move to production, you need to update **3 environment variables** in Vercel:

1. `QBO_BASE_URL` - Switch from sandbox to production API endpoint
2. `QBO_COMPANY_ID` - Your actual company's Realm ID (not sandbox)
3. OAuth tokens - New tokens for your production QuickBooks company

## Step 1: Find Your Production Company ID (Realm ID)

### Method A: From QuickBooks URL
1. Log into your **actual** QuickBooks Online company (not sandbox)
2. Look at the browser URL - it will look like: `https://app.qbo.intuit.com/app/homepage`
3. Navigate to any transaction or report
4. The URL will contain your Company ID: `https://app.qbo.intuit.com/app/company/XXXXXXXXXXXX/...`
5. Copy that number - it's your **Production Company ID**

### Method B: During OAuth Flow
1. When you complete the OAuth authorization (Step 3 below), check the redirect URL
2. It will contain: `?realmId=XXXXXXXXXXXX&code=...`
3. The `realmId` parameter is your **Production Company ID**

### Method C: QuickBooks Settings
1. In QuickBooks, click the **gear icon** (Settings)
2. Go to **Account and Settings** → **Billing & Subscription**
3. Your Company ID may be displayed there

## Step 2: Update Environment Variables in Vercel

Go to your Vercel project settings:

### Update QBO_BASE_URL
**Current (Sandbox):**
```
QBO_BASE_URL=https://sandbox-quickbooks.api.intuit.com
```

**Change to (Production):**
```
QBO_BASE_URL=https://quickbooks.api.intuit.com
```

### Update QBO_COMPANY_ID
**Current (Sandbox):**
```
QBO_COMPANY_ID=<your sandbox realm ID>
```

**Change to (Production):**
```
QBO_COMPANY_ID=<your production realm ID from Step 1>
```

### Keep These The Same
Your Client ID and Secret should work for both sandbox and production (assuming you've approved your app for production in Intuit Developer Portal):

```
QBO_CLIENT_ID=<same as before>
QBO_CLIENT_SECRET=<same as before>
```

## Step 3: Complete OAuth Flow for Production

You need to authorize your app to access your **production** QuickBooks company.

### OAuth Authorization URL

Build this URL with your Client ID:

```
https://appcenter.intuit.com/connect/oauth2?client_id=YOUR_CLIENT_ID&scope=com.intuit.quickbooks.accounting%20com.intuit.quickbooks.payment&redirect_uri=YOUR_REDIRECT_URI&response_type=code&state=production
```

Replace:
- `YOUR_CLIENT_ID` - Your QBO_CLIENT_ID
- `YOUR_REDIRECT_URI` - The redirect URI you registered in Intuit Developer Portal (must be URL-encoded)

### Authorization Steps

1. **Visit the OAuth URL** in your browser (logged into your production QuickBooks account)
2. **Select your production company** from the list shown
3. **Click "Authorize"** to grant access
4. **You'll be redirected** to your redirect URI with a `code` parameter

### Exchange Code for Tokens

Once you have the authorization `code`, exchange it for access/refresh tokens:

**Request:**
```bash
curl -X POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer \
  -H "Authorization: Basic BASE64_ENCODED_CREDENTIALS" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=YOUR_AUTH_CODE&redirect_uri=YOUR_REDIRECT_URI"
```

**BASE64_ENCODED_CREDENTIALS:**
```
Base64( CLIENT_ID:CLIENT_SECRET )
```

You can encode this in terminal:
```bash
echo -n "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" | base64
```

**Response:**
```json
{
  "access_token": "eyJlbmMiOiJBMTI4Q0JDLUhTMjU2...",
  "refresh_token": "L011546037380pPQMhJzMY9hvdpG...",
  "token_type": "bearer",
  "expires_in": 3600,
  "x_refresh_token_expires_in": 8726400
}
```

### Update Token Environment Variables

In Vercel, update:

```
QBO_ACCESS_TOKEN=<access_token from response>
QBO_REFRESH_TOKEN=<refresh_token from response>
```

## Step 4: Verify Configuration

After updating all environment variables in Vercel:

### Checklist
- [ ] `QBO_BASE_URL` = `https://quickbooks.api.intuit.com`
- [ ] `QBO_COMPANY_ID` = Your production company Realm ID
- [ ] `QBO_CLIENT_ID` = Your Client ID (unchanged)
- [ ] `QBO_CLIENT_SECRET` = Your Client Secret (unchanged)
- [ ] `QBO_ACCESS_TOKEN` = New production access token
- [ ] `QBO_REFRESH_TOKEN` = New production refresh token

### Redeploy
1. Trigger a redeploy in Vercel (Settings → Deployments → Redeploy)
2. Or push a new commit to trigger automatic deployment

## Step 5: Test Production Integration

### Test Invoice Creation
1. Go to `https://membershiprenewal.campusstores.ca`
2. Complete a test membership renewal
3. Create an invoice
4. **Check your production QuickBooks** - the invoice should appear there (not in sandbox)

### Verify Automatic Token Refresh
- Your cron job (`/api/auto-refresh-qb-tokens`) runs every 50 minutes
- It automatically refreshes tokens before they expire
- Check Vercel logs to confirm it's working: "✅ QuickBooks tokens refreshed successfully"

## Important Notes

### Token Expiration
- **Access tokens**: Expire in 1 hour (auto-refreshed every 50 minutes)
- **Refresh tokens**: Expire in ~101 days
- After 101 days, you'll need to re-authorize (repeat Step 3)

### Test Email Override Still Active
The system is currently configured to send all invoice emails to `google@campusstores.ca` for testing. This is intentional until you're ready to go fully live.

To remove the email override:
- Edit `/api/create-qbo-invoice.js` (line 626)
- Edit `/api/email-qbo-invoice.js` (line 43)
- Remove the `testEmailOverride` and use actual customer emails

### Sandbox vs Production Data
- **Sandbox customers won't exist** in production - they're separate databases
- First production renewal will create new customer records in production QB
- Invoice numbers will start fresh in production

### Rollback Plan
If you need to switch back to sandbox:

1. Change `QBO_BASE_URL` back to `https://sandbox-quickbooks.api.intuit.com`
2. Change `QBO_COMPANY_ID` back to sandbox realm ID
3. Update `QBO_ACCESS_TOKEN` and `QBO_REFRESH_TOKEN` to sandbox tokens
4. Redeploy

## Troubleshooting

### "401 Unauthorized" Errors
- Tokens expired or invalid
- Re-run OAuth flow (Step 3)
- Check that Company ID matches the company you authorized

### "404 Not Found" Errors
- Wrong Company ID
- Verify you're using production Company ID, not sandbox

### Invoice Not Appearing in QuickBooks
- Check you're logged into the correct QuickBooks company
- Verify `QBO_COMPANY_ID` matches the company you authorized
- Check Vercel logs for error messages

### Automatic Token Refresh Not Working
- Check Vercel cron job is enabled
- Verify `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` are set
- Check Vercel logs: `/api/auto-refresh-qb-tokens`

## Support

If you encounter issues:
1. Check Vercel function logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure OAuth was completed for the correct QuickBooks company
4. Re-authorize if tokens are more than 101 days old

---

**Last Updated:** October 22, 2025
**Environment:** Production Ready
**Status:** Pending OAuth authorization for production company
