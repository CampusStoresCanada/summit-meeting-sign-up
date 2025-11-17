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

  const notionToken = process.env.NOTION_TOKEN;
  const summitRegistrationsDbId = process.env.NOTION_SUMMIT_REGISTRATIONS_DB_ID;
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;

  if (!notionToken || !summitRegistrationsDbId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }

  try {
    const {
      designeeToken,
      registrationId,
      tlpRedSignatureUrl,
      employmentSignatureUrl,
      virtualProtocolSignatureUrl,
      attendanceFormat
    } = req.body;

    if (!designeeToken || !tlpRedSignatureUrl || !employmentSignatureUrl) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    console.log('🔍 Submitting designee agreement for token:', designeeToken.substring(0, 20) + '...');

    // Step 1: Find registration by designee token
    const regResponse = await fetch(`https://api.notion.com/v1/databases/${summitRegistrationsDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          property: 'Designee Token',
          rich_text: { equals: designeeToken }
        }
      })
    });

    const regData = await regResponse.json();

    if (regData.results.length === 0) {
      res.status(404).json({ error: 'Registration not found or token invalid' });
      return;
    }

    const registration = regData.results[0];
    console.log('✅ Found registration:', registration.id);

    // Step 2: Check if token is expired
    const expiresDate = registration.properties["Designee Token Expires"]?.date?.start;
    if (expiresDate && new Date(expiresDate) < new Date()) {
      res.status(403).json({ error: 'This registration link has expired' });
      return;
    }

    // Step 3: Update registration with designee signatures and acknowledgments
    const updateProperties = {
      "Designee TLP Red Signature URL": {
        url: tlpRedSignatureUrl
      },
      "Designee Employment Signature URL": {
        url: employmentSignatureUrl
      },
      "Designee Breach Acknowledgment": {
        checkbox: true
      },
      "Designee Registration Complete": {
        checkbox: true
      },
      "Designee Completed At": {
        date: { start: new Date().toISOString() }
      }
    };

    // Add virtual protocol signature if provided
    if (virtualProtocolSignatureUrl) {
      updateProperties["Designee Virtual Protocol Signature URL"] = {
        url: virtualProtocolSignatureUrl
      };
      updateProperties["Designee Virtual Protocol Acknowledged"] = {
        checkbox: true
      };
    }

    // Update attendance format if provided
    if (attendanceFormat) {
      updateProperties["Designee Attendance Format"] = {
        select: { name: attendanceFormat === 'in-person' ? 'In-Person' : 'Virtual' }
      };
    }

    const updateResponse = await fetch(`https://api.notion.com/v1/pages/${registration.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ properties: updateProperties })
    });

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      console.error('❌ Failed to update registration:', errorData);
      throw new Error('Failed to update registration');
    }

    console.log('✅ Updated registration with designee agreement');

    // Step 4: Get organization and contact info for confirmation emails
    const orgRelation = registration.properties["Organization"]?.relation?.[0]?.id;
    const designeeRelation = registration.properties["Designee Contact"]?.relation?.[0]?.id;

    let organizationName = 'your institution';
    let primaryMemberEmail = null;
    let designeeName = 'Designee';
    let designeeEmail = null;

    // Get organization info
    if (orgRelation) {
      const orgResponse = await fetch(`https://api.notion.com/v1/pages/${orgRelation}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28'
        }
      });

      const orgData = await orgResponse.json();
      organizationName = orgData.properties.Organization?.title?.[0]?.text?.content || organizationName;
      primaryMemberEmail = orgData.properties["Primary Email"]?.email ||
                          orgData.properties["Contact Email"]?.email ||
                          null;
    }

    // Get designee info
    if (designeeRelation) {
      const contactResponse = await fetch(`https://api.notion.com/v1/pages/${designeeRelation}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28'
        }
      });

      const contactData = await contactResponse.json();
      designeeName = contactData.properties.Name?.title?.[0]?.text?.content || designeeName;
      designeeEmail = contactData.properties["Work Email"]?.email || null;
    }

    // Step 5: Send confirmation emails
    try {
      const { sendEmail } = await import('./lib/resend-mailer.js');

      // Email to designee
      if (designeeEmail) {
        await sendEmail({
          to: designeeEmail,
          subject: 'Managers & Directors Summit - Agreement Confirmed',
          body: `
            <h2>Summit Agreement Confirmed</h2>

            <p>Dear ${designeeName},</p>

            <p>Thank you for completing your confidentiality agreement for the Managers & Directors Summit.</p>

            <p>Your registration is now complete. You will receive additional details about the summit closer to the event date.</p>

            <p>If you have any questions, please contact <a href="mailto:info@campusstores.ca">info@campusstores.ca</a></p>

            <p>—<br>Campus Stores Canada</p>
          `
        });

        console.log('✅ Confirmation email sent to designee');
      }

      // Email to primary member
      if (primaryMemberEmail) {
        await sendEmail({
          to: primaryMemberEmail,
          subject: 'Your Designee Has Completed Their Summit Agreement',
          body: `
            <h2>Designee Agreement Completed</h2>

            <p>Good news! ${designeeName} has completed their confidentiality agreement for the Managers & Directors Summit.</p>

            <p><strong>Organization:</strong> ${organizationName}</p>
            <p><strong>Designee:</strong> ${designeeName}</p>

            <p>Both you and ${designeeName} are now confirmed for the summit. You will both receive additional details closer to the event date.</p>

            <p>If you have any questions, please contact <a href="mailto:info@campusstores.ca">info@campusstores.ca</a></p>

            <p>—<br>Campus Stores Canada</p>
          `
        });

        console.log('✅ Notification email sent to primary member');
      }

    } catch (emailError) {
      console.error('💥 Error sending confirmation emails:', emailError);
      // Don't fail the submission if emails fail
    }

    res.status(200).json({
      success: true,
      message: 'Designee agreement submitted successfully'
    });

  } catch (error) {
    console.error('💥 Error submitting designee agreement:', error);
    res.status(500).json({
      error: 'Failed to submit agreement',
      details: error.message
    });
  }
}
