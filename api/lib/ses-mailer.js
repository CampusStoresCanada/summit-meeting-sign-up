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
