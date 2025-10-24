# Squarespace Conference Delegate Webhook Setup

This replaces the flaky Zapier integration with a reliable API key-based webhook system.

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

## Step 4: Set Up Webhook Subscription

1. Visit: `https://membershiprenewal.campusstores.ca/api/setup-squarespace-webhook`
2. You should see a success page confirming the webhook is active
3. The webhook secret will be automatically saved to Vercel

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

## What the Webhook Does

When an order is created with SKU 26999:
1. Extracts form data from each delegate registration
2. Searches for existing contact by email in Notion
3. If contact exists: Updates their information
4. If contact doesn't exist: Creates new contact
5. Adds "26 Conference Delegate" tag
6. Adds "First Conference" tag if applicable
7. Handles multiple registrations in one order
8. Sends error notifications via AWS SES if something fails

## Troubleshooting

### Webhook not receiving orders
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

- `/api/squarespace-delegate-webhook.js` - Main webhook endpoint
- `/api/setup-squarespace-webhook.js` - One-time setup script
- `/api/lib/ses-mailer.js` - Error notifications

## OAuth Files (Not Needed)

These files were created for OAuth but are not needed since we're using API keys:
- `/api/squarespace-oauth-start.js` - Can be deleted
- `/api/squarespace-oauth-callback.js` - Can be deleted
- `/api/auto-refresh-squarespace-token.js` - Can be deleted
- Cron job for Squarespace token refresh - Can be removed from vercel.json

## Future: Exhibitor Registration

You can duplicate this setup for exhibitor registrations:
1. Create `/api/squarespace-exhibitor-webhook.js` (copy delegate webhook)
2. Change SKU filter to your exhibitor SKU
3. Change tags to exhibitor-specific tags
4. Use same API key, just add another webhook subscription
