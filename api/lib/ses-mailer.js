// api/lib/ses-mailer.js - AWS SES Email Sending Utility
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

/**
 * Send an email using AWS SES
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.body - Email body (plain text)
 * @param {string} options.from - Sender email address (must be verified in SES)
 * @returns {Promise<Object>} - Result object with success status
 */
export async function sendEmail({ to, subject, body, from }) {
  // Get AWS credentials from environment variables
  const region = process.env.AWS_SES_REGION || process.env.S3_REGION || 'us-east-1';
  const senderEmail = from || process.env.AWS_SES_SENDER_EMAIL || 'noreply@campusstores.ca';

  // Validate required environment variables
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ Missing AWS credentials for SES');
    return {
      success: false,
      error: 'AWS credentials not configured'
    };
  }

  if (!to) {
    console.error('❌ Missing recipient email address');
    return {
      success: false,
      error: 'Recipient email address required'
    };
  }

  try {
    console.log(`📧 Sending email via AWS SES to: ${to}`);
    console.log(`📧 Subject: ${subject}`);
    console.log(`📧 Region: ${region}`);

    // Create SES client
    const sesClient = new SESClient({
      region: region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    // Prepare email parameters
    const params = {
      Source: senderEmail,
      Destination: {
        ToAddresses: [to]
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8'
        },
        Body: {
          Text: {
            Data: body,
            Charset: 'UTF-8'
          }
        }
      }
    };

    // Send email
    const command = new SendEmailCommand(params);
    const response = await sesClient.send(command);

    console.log('✅ Email sent successfully via AWS SES');
    console.log('📧 Message ID:', response.MessageId);

    return {
      success: true,
      messageId: response.MessageId
    };

  } catch (error) {
    console.error('❌ Failed to send email via AWS SES:', error);

    // Check for common SES errors
    if (error.name === 'MessageRejected') {
      console.error('💥 Email rejected - check that sender email is verified in SES');
    } else if (error.name === 'MailFromDomainNotVerified') {
      console.error('💥 Domain not verified in SES');
    } else if (error.name === 'ConfigurationSetDoesNotExist') {
      console.error('💥 SES configuration set not found');
    }

    return {
      success: false,
      error: error.message,
      errorName: error.name
    };
  }
}

/**
 * Send an error notification email
 * @param {Object} options - Error notification options
 * @param {string} options.subject - Email subject
 * @param {string} options.body - Email body with error details
 * @returns {Promise<Object>} - Result object with success status
 */
export async function sendErrorNotification({ subject, body }) {
  const adminEmail = process.env.ERROR_NOTIFICATION_EMAIL || 'steve@campusstores.ca';

  console.log(`🚨 Sending error notification to: ${adminEmail}`);

  return await sendEmail({
    to: adminEmail,
    subject: `[CSC Membership] ${subject}`,
    body: body
  });
}

/**
 * Send bookkeeper notification for invoice coding
 * @param {Object} invoiceDetails - Invoice details for coding breakdown
 * @returns {Promise<Object>} - Result object with success status
 */
export async function sendBookkeeperNotification(invoiceDetails) {
  const bookkeeperEmail = process.env.BOOKKEEPER_EMAIL || process.env.ERROR_NOTIFICATION_EMAIL || 'steve@campusstores.ca';

  const {
    organizationName,
    invoiceId,
    invoiceNumber,
    invoiceUrl,
    billingDisplay,
    institutionSize,
    membershipFee,
    conferenceTotal,
    conferenceHST,
    conferenceAttendees,
    totalAmount,
    customerAddress
  } = invoiceDetails;

  console.log(`📊 Sending bookkeeper notification to: ${bookkeeperEmail}`);

  // Map institution size to account numbers
  const membershipAccounts = {
    'XSmall': '4114',
    'Small': '4118',
    'Medium': '4119',
    'Large': '4120',
    'XLarge': '4121'
  };

  const membershipAccount = membershipAccounts[institutionSize] || '4110';

  // Build email body
  let body = `QUICKBOOKS INVOICE CODING NOTIFICATION\n`;
  body += `========================================\n\n`;

  body += `Organization: ${organizationName}\n`;
  body += `Invoice Number: ${invoiceNumber}\n`;
  body += `QB Invoice ID: ${invoiceId}\n`;
  body += `Invoice Total: $${totalAmount.toFixed(2)}\n\n`;

  if (customerAddress) {
    body += `Billing Address:\n`;
    body += `${customerAddress.streetAddress || ''}\n`;
    body += `${customerAddress.city || ''}, ${customerAddress.province || ''} ${customerAddress.postalCode || ''}\n\n`;
  }

  body += `View Invoice: ${invoiceUrl}\n\n`;

  body += `BILLING TYPE: ${billingDisplay === 'single-item' ? 'SINGLE LINE ITEM (Combined Payment)' : 'INDIVIDUAL LINE ITEMS'}\n`;
  body += `========================================\n\n`;

  if (billingDisplay === 'single-item') {
    body += `⚠️ CODING REQUIRED - SINGLE LINE ITEM INVOICE\n`;
    body += `This invoice was billed as a single line item in QuickBooks.\n`;
    body += `Revenue must be split manually using the breakdown below.\n\n`;

    body += `REVENUE ALLOCATION:\n`;
    body += `-------------------\n`;
    body += `Account ${membershipAccount}: Membership ${institutionSize}\n`;
    body += `  Amount: $${membershipFee.toFixed(2)}\n\n`;

    body += `Account 4210: Conference - Delegate Reg\n`;
    body += `  Amount: $${conferenceTotal.toFixed(2)}\n`;
    body += `  Attendees: ${conferenceAttendees.paid} paid, ${conferenceAttendees.free} complimentary\n\n`;

    if (conferenceAttendees.breakdown && conferenceAttendees.breakdown.length > 0) {
      body += `Conference Attendees Detail:\n`;
      conferenceAttendees.breakdown.forEach(attendee => {
        const icon = attendee.category === 'paid' ? '💵' : '🎫';
        body += `  ${icon} ${attendee.name} - ${attendee.reason}\n`;
      });
      body += `\n`;
    }

    body += `Tax (HST): $${conferenceHST.toFixed(2)}\n`;
    body += `  (Included in QB invoice total)\n\n`;

    body += `JOURNAL ENTRY NEEDED:\n`;
    body += `-------------------\n`;
    body += `Dr. Account 4110 (Combined Revenue): $${(membershipFee + conferenceTotal).toFixed(2)}\n`;
    body += `Cr. Account ${membershipAccount} (Membership): $${membershipFee.toFixed(2)}\n`;
    body += `Cr. Account 4210 (Conference): $${conferenceTotal.toFixed(2)}\n\n`;

  } else {
    body += `✓ NO CODING REQUIRED - LINE ITEMS SEPARATED\n`;
    body += `This invoice has individual line items already coded in QuickBooks.\n\n`;

    body += `LINE ITEM BREAKDOWN:\n`;
    body += `-------------------\n`;
    body += `Line 1: Membership ${institutionSize}\n`;
    body += `  Account: ${membershipAccount}\n`;
    body += `  Amount: $${membershipFee.toFixed(2)}\n\n`;

    if (conferenceTotal > 0) {
      body += `Line 2: Conference - Delegate Reg\n`;
      body += `  Account: 4210\n`;
      body += `  Amount: $${conferenceTotal.toFixed(2)}\n`;
      body += `  Attendees: ${conferenceAttendees.paid} paid, ${conferenceAttendees.free} complimentary\n\n`;

      if (conferenceAttendees.breakdown && conferenceAttendees.breakdown.length > 0) {
        body += `Conference Attendees Detail:\n`;
        conferenceAttendees.breakdown.forEach(attendee => {
          const icon = attendee.category === 'paid' ? '💵' : '🎫';
          body += `  ${icon} ${attendee.name} - ${attendee.reason}\n`;
        });
        body += `\n`;
      }
    }

    body += `Tax: HST - $${conferenceHST.toFixed(2)}\n`;
    body += `  (Automatically applied by QuickBooks)\n\n`;
  }

  body += `ACCOUNT REFERENCE:\n`;
  body += `-------------------\n`;
  body += `4110: Membership Revenue (Combined - default)\n`;
  body += `4114: Membership Revenue - XSmall\n`;
  body += `4118: Membership Revenue - Small\n`;
  body += `4119: Membership Revenue - Medium\n`;
  body += `4120: Membership Revenue - Large\n`;
  body += `4121: Membership Revenue - XLarge\n`;
  body += `4210: Conference - Delegate Reg\n\n`;

  body += `---\n`;
  body += `This notification was generated automatically when the invoice was created.\n`;
  body += `Timestamp: ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}\n`;

  const subject = `QB Invoice ${invoiceNumber} - ${billingDisplay === 'single-item' ? 'CODING REQUIRED' : 'Info Only'} - ${organizationName}`;

  return await sendEmail({
    to: bookkeeperEmail,
    subject: `[Bookkeeper] ${subject}`,
    body: body
  });
}
