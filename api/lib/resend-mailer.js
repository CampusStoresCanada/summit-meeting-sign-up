// api/lib/resend-mailer.js - Resend Email Sending Utility
// Much simpler than AWS SES - just works!

/**
 * Send an email using Resend
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.body - Email body (HTML)
 * @param {string} options.from - Sender email address
 * @returns {Promise<Object>} - Result object with success status
 */
export async function sendEmail({ to, subject, body, from }) {
  const apiKey = process.env.RESEND_API_KEY;
  const senderEmail = from || process.env.RESEND_SENDER_EMAIL || 'Summit <noreply@campusstores.ca>';

  // TEST MODE: Override recipient email for testing
  const testEmailOverride = process.env.TEST_EMAIL_OVERRIDE;
  const originalTo = to;
  if (testEmailOverride) {
    to = testEmailOverride;
    console.log(`🧪 TEST MODE: Overriding recipient ${originalTo} → ${to}`);
  }

  if (!apiKey) {
    console.error('❌ Missing RESEND_API_KEY environment variable');
    return {
      success: false,
      error: 'Resend API key not configured'
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
    console.log(`📧 Sending email via Resend to: ${to}`);
    if (testEmailOverride && originalTo !== to) {
      console.log(`📧 Original recipient: ${originalTo}`);
    }
    console.log(`📧 Subject: ${subject}`);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: senderEmail,
        to: [to],
        subject: subject,
        html: body
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Resend API error:', data);
      return {
        success: false,
        error: data.message || 'Failed to send email',
        details: data
      };
    }

    console.log('✅ Email sent successfully via Resend');
    console.log('📧 Message ID:', data.id);

    return {
      success: true,
      messageId: data.id
    };

  } catch (error) {
    console.error('❌ Failed to send email via Resend:', error);
    return {
      success: false,
      error: error.message
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

  // Convert plain text to HTML
  const htmlBody = `<pre>${body}</pre>`;

  return await sendEmail({
    to: adminEmail,
    subject: `[CSC Summit] ${subject}`,
    body: htmlBody
  });
}
