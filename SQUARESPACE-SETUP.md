# Squarespace Conference Delegate Polling Setup

This replaces the flaky Zapier integration with a reliable API key-based polling system.

**How it works:** Every 5 minutes, the system polls Squarespace for new delegate orders and automatically processes them into Notion. There's a 0-5 minute delay, but for delegate registrations this is totally acceptable.

## Step 1: Generate Squarespace API Key

1. Log in to your Squarespace site
2. Go to **Settings → Advanced → Developer API Keys**
3. Click **Generate Key**
4. Fill out:
   - **Key Name:** CSC Conference Delegates
   - **Permissions:**
     - ✅ **Orders** - Read and Write
     - ✅ **Webhook Subscriptions** - Read and Write
5. Click **Generate**
6. **IMPORTANT:** Copy the API key immediately - you can only see it once!

## Step 2: Add Environment Variables to Vercel

Add these to your Vercel project environment variables:

```
SQUARESPACE_API_KEY=<your-generated-api-key-from-step-1>
NOTION_CONTACTS_DB_ID=<your-notion-contacts-database-id>
```

To get your Notion Contacts Database ID:
1. Open your Contacts database in Notion
2. Copy the URL: `https://notion.so/yourworkspace/<THIS-IS-THE-ID>?v=...`
3. The ID is the long string before the `?v=`

## Step 3: Create "26 Conference Delegate" Tag in Notion

1. Go to your Notion Tag System database
2. Create a new tag called **"26 Conference Delegate"** (exact name, case-sensitive)
3. Optionally create **"First Conference"** tag as well

## Step 4: Add "Squarespace Order ID" Property to Notion Contacts

1. Open your Notion Contacts database
2. Add a new property:
   - **Name:** Squarespace Order ID
   - **Type:** Text
3. This prevents processing the same order multiple times

## Step 5: Test It!

1. Create a test order in Squarespace with SKU **26999** (Conference Delegate Registration)
2. Fill out the product form with:
   - Name
   - Email
   - Job Title
   - Dietary Restrictions
   - Consent for Recording
   - First Conference (Yes/No)
   - CanCOLL Member (Yes/No)
3. Complete the order
4. Check Vercel logs: `https://vercel.com/your-project/logs`
5. Check Notion Contacts database - the delegate should appear with:
   - Name, email, job title, dietary restrictions filled in
   - "26 Conference Delegate" tag added
   - "First Conference" tag added (if they answered yes)

## What the Polling System Does

Every 5 minutes, it checks for new orders with SKU 26999 and:
1. Extracts form data from each delegate registration
2. Searches for existing contact by email in Notion
3. If contact exists: Updates their information
4. If contact doesn't exist: Creates new contact
5. Adds "26 Conference Delegate" tag
6. Adds "First Conference" tag if applicable
7. Handles multiple registrations in one order
8. Sends error notifications via AWS SES if something fails

## Troubleshooting

### Polling not finding orders
- Check Vercel logs for errors
- Verify SQUARESPACE_API_KEY is set correctly
- Make sure the API key has Orders (Read/Write) and Webhook Subscriptions permissions

### Contact not appearing in Notion
- Verify NOTION_CONTACTS_DB_ID is correct
- Check that contact has an email address (required field)
- Look for error notification emails

### Tags not being added
- Verify "26 Conference Delegate" tag exists in Tag System (exact spelling)
- Check Vercel logs for "tag not found" errors

### API Key Expiry
Unlike Zapier, Squarespace API keys **do not expire automatically**. You only need to regenerate if:
- You revoke the key manually
- There's a security issue
- You change permissions

## Files Involved

- `/api/poll-squarespace-delegates.js` - Polling endpoint (runs every 5 minutes)
- `/api/lib/ses-mailer.js` - Error notifications
- `/api/vercel.json` - Cron job configuration

## Unused Files (Can be Deleted)

These files were created for webhook/OAuth approaches but aren't needed for polling:
- `/api/squarespace-delegate-webhook.js` - Webhook endpoint (requires OAuth)
- `/api/squarespace-oauth-start.js` - OAuth flow (not needed)
- `/api/squarespace-oauth-callback.js` - OAuth callback (not needed)
- `/api/auto-refresh-squarespace-token.js` - Token refresh (not needed)
- `/api/setup-squarespace-webhook.js` - Webhook setup (requires OAuth)

## Future: Exhibitor Registration

You can duplicate this setup for exhibitor registrations:
1. Create `/api/poll-squarespace-exhibitors.js` (copy delegate polling script)
2. Change SKU filter to your exhibitor SKU
3. Change tags to exhibitor-specific tags
4. Add another cron job to vercel.json
5. Use same API key - no additional setup needed!
