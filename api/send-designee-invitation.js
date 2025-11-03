export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const {
      designeeEmail,
      designeeName,
      primaryMemberName,
      institutionName,
      designeeToken,
      attendanceFormat
    } = req.body;

    if (!designeeEmail || !designeeName || !designeeToken) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    console.log('📧 Sending designee invitation to:', designeeEmail);

    // Import email utility
    const { sendEmail } = await import('./lib/resend-mailer.js');

    // Construct designee registration URL
    // Use production URL, not VERCEL_URL (which is preview URLs)
    const baseUrl = process.env.PRODUCTION_URL || 'https://summit.campusstores.ca';
    const designeeUrl = `${baseUrl}/designee.html?token=${designeeToken}`;

    console.log('🔗 Designee URL:', designeeUrl);

    // Build email body
    const emailBody = `
      <h2>You've Been Designated to Attend the Managers & Directors Summit</h2>

      <p>Hello ${designeeName},</p>

      <p>${primaryMemberName} from ${institutionName} has designated you to attend the CSC Managers & Directors Summit.</p>

      <h3>Your Attendance Format:</h3>
      <p><strong>${attendanceFormat === 'in-person' ? 'In-Person' : 'Virtual (Online)'}</strong></p>

      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 1em; margin: 1.5em 0;">
        <p><strong>Important: This meeting requires strict confidentiality</strong></p>
        <p>Before you can attend, you must review and sign a confidentiality agreement. This is not optional.</p>
      </div>

      <h3>Next Steps:</h3>
      <ol>
        <li>Click the link below to access your personalized registration form</li>
        <li>Review the confidentiality agreement carefully</li>
        <li>Sign the agreement and upload the signed PDF or image</li>
        <li>Complete all required acknowledgments</li>
      </ol>

      <div style="text-align: center; margin: 2em 0;">
        <a href="${designeeUrl}" style="background: #0071bc; color: white; padding: 1em 2em; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 600;">
          Complete Your Registration
        </a>
      </div>

      <p><strong>This link will expire in 14 days.</strong> If you need a new link, please contact your primary member or <a href="mailto:info@campusstores.ca">info@campusstores.ca</a></p>

      <h3>What is the Managers & Directors Summit?</h3>
      <p>This is a highly confidential meeting where campus store managers and directors discuss:</p>
      <ul>
        <li>Real financial situations</li>
        <li>Staffing challenges and expertise needs</li>
        <li>Operational challenges and solutions</li>
        <li>Strategic decisions and institutional requirements</li>
      </ul>

      <p>Everything discussed operates under "Traffic Light Protocol Red" - the highest level of confidentiality.</p>

      <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 1em; margin: 1.5em 0;">
        <p><strong>Breach of Confidentiality = Immediate Membership Termination</strong></p>
        <p>Even accidental disclosure or sharing rumors will result in immediate termination of your institution's CSC membership with no appeals or refunds.</p>
      </div>

      <p>If you have any questions about this invitation or the summit, please contact:</p>
      <p><a href="mailto:info@campusstores.ca">info@campusstores.ca</a></p>

      <p>—<br>Campus Stores Canada</p>

      <hr style="margin: 2em 0; border: none; border-top: 1px solid #dee2e6;">

      <p style="font-size: 0.85em; color: #6c757d;">
        <strong>Registration Link:</strong><br>
        ${designeeUrl}
      </p>

      <p style="font-size: 0.85em; color: #6c757d;">
        This link is unique to you and should not be shared. If you did not expect this invitation, please contact <a href="mailto:info@campusstores.ca">info@campusstores.ca</a>
      </p>
    `;

    // Send email
    await sendEmail({
      to: designeeEmail,
      subject: `You've Been Designated for the CSC Managers & Directors Summit`,
      body: emailBody,
      from: process.env.AWS_SES_SENDER_EMAIL || 'noreply@campusstores.ca'
    });

    console.log('✅ Designee invitation email sent successfully');

    res.status(200).json({
      success: true,
      message: 'Designee invitation email sent'
    });

  } catch (error) {
    console.error('💥 Error sending designee invitation:', error);
    res.status(500).json({
      error: 'Failed to send invitation email',
      details: error.message
    });
  }
}
