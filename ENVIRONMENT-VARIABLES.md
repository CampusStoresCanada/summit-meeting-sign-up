# Environment Variables Reference

Environment variables required for the CSC Summit Registration System.

## Notion Configuration

### Required
```bash
NOTION_TOKEN=<your_notion_integration_token>
NOTION_ORGANIZATIONS_DB_ID=<organizations_database_id>
NOTION_CONTACTS_DB_ID=<contacts_database_id>
NOTION_SUMMIT_REGISTRATIONS_DB_ID=<summit_registrations_database_id>
```

**Notes:**
- Get Notion token from: https://www.notion.so/my-integrations
- Database IDs are the 32-character hex strings from database URLs

## AWS Configuration

### For S3 File Uploads
```bash
AWS_ACCESS_KEY_ID=<your_aws_access_key>
AWS_SECRET_ACCESS_KEY=<your_aws_secret_key>
S3_BUCKET_NAME=<your_s3_bucket_name>
S3_REGION=<aws_region>
```

**Notes:**
- Used for storing signed agreement PDFs and other uploaded files
- Ensure S3 bucket has appropriate permissions for presigned URLs

## Email Configuration (Resend)

### Required for Email Notifications
```bash
RESEND_API_KEY=<your_resend_api_key>
RESEND_FROM_EMAIL=<your_verified_sender_email>
ERROR_NOTIFICATION_EMAIL=<admin_email_for_errors>
```

**Notes:**
- Resend is used for sending designee invitations and notifications
- `RESEND_FROM_EMAIL` must be a verified email or domain in Resend
- `ERROR_NOTIFICATION_EMAIL` defaults to `steve@campusstores.ca` if not set

## Quick Setup Checklist

### Required for Summit Registration
- [ ] All Notion variables (4 variables)
- [ ] AWS S3 variables (4 variables)
- [ ] Resend email variables (3 variables)

**Total:** 11 required environment variables

## Testing Your Configuration

### Test Notion Connection
Verify your Notion token has access to all required databases by attempting to fetch organization data.

### Test S3 Uploads
Upload a test file to ensure S3 credentials and bucket permissions are correct.

### Test Email Sending
Send a test designee invitation to verify Resend configuration.

## Troubleshooting

### Notion 401 Errors
- Check `NOTION_TOKEN` is valid
- Verify integration has access to all databases
- Ensure database IDs are correct (32 hex characters)

### AWS S3 Errors
- Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are correct
- Check S3 bucket exists and region is correct
- Ensure bucket policy allows presigned URL generation

### Email Sending Errors
- Verify `RESEND_API_KEY` is valid
- Check sender email is verified in Resend dashboard
- Ensure you haven't exceeded Resend rate limits

---

**Last Updated:** November 6, 2025
**Total Variables:** 11 required
