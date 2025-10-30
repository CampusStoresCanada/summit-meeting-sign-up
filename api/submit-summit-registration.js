import crypto from 'crypto';

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
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;
  const summitRegistrationsDbId = process.env.NOTION_SUMMIT_REGISTRATIONS_DB_ID;

  if (!notionToken || !organizationsDbId || !contactsDbId || !summitRegistrationsDbId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }

  try {
    const {
      token,
      organizationId,
      primaryIsAttending,
      primaryFormat,
      primaryAgreementUrl,
      hasDesignee,
      designeeContact,
      designeeFormat,
      certificationUrl
    } = req.body;

    console.log('🔍 Summit registration submission for token:', token);

    // Step 1: Get organization info
    const orgResponse = await fetch(`https://api.notion.com/v1/databases/${organizationsDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          property: 'Token',
          rich_text: { equals: token }
        }
      })
    });

    const orgData = await orgResponse.json();
    if (orgData.results.length === 0) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const org = orgData.results[0];
    const orgId = org.id;
    const organizationName = org.properties.Organization?.title?.[0]?.text?.content || '';

    console.log(`🏢 Found organization: ${organizationName}`);

    // Step 2: Check if registration already exists
    const existingRegResponse = await fetch(`https://api.notion.com/v1/databases/${summitRegistrationsDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          property: 'Token',
          rich_text: { equals: token }
        }
      })
    });

    const existingRegData = await existingRegResponse.json();
    const existingRegistration = existingRegData.results[0];

    // Step 3: Handle designee contact if needed
    let designeeContactId = null;
    if (hasDesignee && designeeContact) {
      if (designeeContact.isNew) {
        // Create new contact
        console.log('➕ Creating new designee contact:', designeeContact.name);

        const contactData = {
          parent: { database_id: contactsDbId },
          properties: {
            "Name": {
              title: [{ text: { content: designeeContact.name } }]
            },
            "First Name": {
              rich_text: [{ text: { content: designeeContact.name.split(' ')[0] || '' } }]
            },
            "Work Email": {
              email: designeeContact.email
            },
            "Work Phone Number": {
              phone_number: designeeContact.phone || null
            },
            "Role/Title": {
              rich_text: [{ text: { content: designeeContact.title || '' } }]
            },
            "Contact Type": {
              multi_select: [{ name: "Vendor Partner" }]
            },
            "Organization": {
              relation: [{ id: orgId }]
            },
            "Notes": {
              rich_text: [{ text: { content: "Designated for Managers & Directors Summit" } }]
            }
          }
        };

        const createContactResponse = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify(contactData)
        });

        if (createContactResponse.ok) {
          const createdContact = await createContactResponse.json();
          designeeContactId = createdContact.id;
          console.log(`✅ Created designee contact: ${designeeContact.name}`);
        } else {
          const errorData = await createContactResponse.json();
          console.error('❌ Failed to create designee contact:', errorData);
          throw new Error('Failed to create designee contact');
        }
      } else {
        // Use existing contact
        designeeContactId = designeeContact.id;
        console.log('✅ Using existing designee contact:', designeeContact.name);
      }
    }

    // Step 4: Generate designee token if needed
    let designeeToken = null;
    let designeeTokenExpires = null;
    if (hasDesignee) {
      designeeToken = `designee-${crypto.randomBytes(32).toString('hex')}`;
      // Set expiration to 14 days from now
      const expiresDate = new Date();
      expiresDate.setDate(expiresDate.getDate() + 14);
      designeeTokenExpires = expiresDate.toISOString();
      console.log('🔑 Generated designee token (expires:', designeeTokenExpires, ')');
    }

    // Step 5: Build registration properties
    const registrationProperties = {
      "Token": {
        rich_text: [{ text: { content: token } }]
      },
      "Organization": {
        relation: [{ id: orgId }]
      },
      "Primary Is Attending": {
        checkbox: primaryIsAttending
      },
      "Primary Attendance Format": {
        select: primaryIsAttending ? { name: primaryFormat === 'in-person' ? 'In-Person' : 'Virtual' } : { name: 'Not Attending' }
      },
      "Primary Breach Acknowledgment": {
        checkbox: true
      },
      "Has Designee": {
        checkbox: hasDesignee
      },
      "Updated At": {
        date: { start: new Date().toISOString() }
      }
    };

    // Add primary agreement URL if attending
    if (primaryIsAttending && primaryAgreementUrl) {
      registrationProperties["Primary Agreement URL"] = {
        url: primaryAgreementUrl
      };
    }

    // Add virtual protocol if virtual
    if (primaryIsAttending && primaryFormat === 'virtual') {
      registrationProperties["Primary Virtual Protocol Acknowledged"] = {
        checkbox: true
      };
    }

    // Add designee information if applicable
    if (hasDesignee) {
      registrationProperties["Designee Token"] = {
        rich_text: [{ text: { content: designeeToken } }]
      };

      registrationProperties["Designee Token Expires"] = {
        date: { start: designeeTokenExpires }
      };

      if (designeeContactId) {
        registrationProperties["Designee Contact"] = {
          relation: [{ id: designeeContactId }]
        };
      }

      registrationProperties["Designee Attendance Format"] = {
        select: { name: designeeFormat === 'in-person' ? 'In-Person' : 'Virtual' }
      };

      registrationProperties["Designee Is Attending"] = {
        checkbox: true
      };

      if (certificationUrl) {
        registrationProperties["Primary Certification URL"] = {
          url: certificationUrl
        };
      }
    }

    // Step 6: Create or update registration
    let registrationId;
    let registrationTitle;

    if (existingRegistration) {
      // Update existing registration
      console.log('✏️ Updating existing registration');

      const updateResponse = await fetch(`https://api.notion.com/v1/pages/${existingRegistration.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({ properties: registrationProperties })
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        console.error('❌ Failed to update registration:', errorData);
        throw new Error('Failed to update registration');
      }

      const updatedReg = await updateResponse.json();
      registrationId = updatedReg.id;
      registrationTitle = updatedReg.properties["Registration ID"]?.title?.[0]?.text?.content || registrationId.substring(0, 8);
      console.log('✅ Updated registration:', registrationTitle);

    } else {
      // Create new registration
      console.log('➕ Creating new registration');

      // Generate registration ID
      const regId = `REG-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      registrationProperties["Registration ID"] = {
        title: [{ text: { content: regId } }]
      };

      registrationProperties["Created At"] = {
        date: { start: new Date().toISOString() }
      };

      const createData = {
        parent: { database_id: summitRegistrationsDbId },
        properties: registrationProperties
      };

      const createResponse = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify(createData)
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        console.error('❌ Failed to create registration:', errorData);
        throw new Error('Failed to create registration');
      }

      const createdReg = await createResponse.json();
      registrationId = createdReg.id;
      registrationTitle = regId;
      console.log('✅ Created registration:', registrationTitle);
    }

    // Step 7: Send designee invitation email if needed
    if (hasDesignee && designeeToken && designeeContact) {
      console.log('📧 Sending designee invitation email...');

      try {
        const emailResponse = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/send-designee-invitation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            designeeEmail: designeeContact.email || designeeContact.workEmail,
            designeeName: designeeContact.name,
            primaryMemberName: organizationName,
            institutionName: organizationName,
            designeeToken: designeeToken,
            attendanceFormat: designeeFormat
          })
        });

        if (emailResponse.ok) {
          console.log('✅ Designee invitation email sent');

          // Update registration with invitation sent timestamp
          await fetch(`https://api.notion.com/v1/pages/${registrationId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify({
              properties: {
                "Designee Invitation Sent At": {
                  date: { start: new Date().toISOString() }
                }
              }
            })
          });
        } else {
          console.error('⚠️ Failed to send designee invitation email');
        }
      } catch (emailError) {
        console.error('💥 Error sending designee email:', emailError);
        // Don't fail the whole registration if email fails
      }
    }

    // Step 8: Send confirmation email to primary member
    console.log('📧 Sending confirmation email to primary member...');

    try {
      const { sendEmail } = await import('./lib/ses-mailer.js');

      const primaryEmail = org.properties["Primary Email"]?.email ||
                          org.properties["Contact Email"]?.email ||
                          null;

      if (primaryEmail) {
        let emailBody = `
          <h2>Managers & Directors Summit Registration Confirmed</h2>

          <p>Thank you for completing your registration for the Managers & Directors Summit.</p>

          <h3>Registration Details:</h3>
          <ul>
            <li><strong>Organization:</strong> ${organizationName}</li>
            <li><strong>Registration ID:</strong> ${registrationTitle}</li>
            <li><strong>Your Attendance:</strong> ${primaryIsAttending ? (primaryFormat === 'in-person' ? 'In-Person' : 'Virtual') : 'Not Attending'}</li>
        `;

        if (hasDesignee && designeeContact) {
          emailBody += `
            <li><strong>Designee:</strong> ${designeeContact.name}</li>
            <li><strong>Designee Attendance:</strong> ${designeeFormat === 'in-person' ? 'In-Person' : 'Virtual'}</li>
          `;
        }

        emailBody += `
          </ul>

          ${hasDesignee ? `
          <h3>Next Steps:</h3>
          <p>${designeeContact.name} will receive a separate email with a unique link to complete their confidentiality agreement. Their registration will be pending until they complete this step.</p>
          ` : ''}

          <p>You will receive additional details about the summit closer to the event date.</p>

          <p>If you have any questions, please contact <a href="mailto:info@campusstores.ca">info@campusstores.ca</a></p>

          <p>—<br>Campus Stores Canada</p>
        `;

        await sendEmail({
          to: primaryEmail,
          subject: 'Managers & Directors Summit Registration Confirmed',
          body: emailBody
        });

        console.log('✅ Confirmation email sent to primary member');
      }
    } catch (emailError) {
      console.error('💥 Error sending confirmation email:', emailError);
      // Don't fail registration if email fails
    }

    res.status(200).json({
      success: true,
      registrationId: registrationId,
      registrationTitle: registrationTitle,
      designeeToken: designeeToken,
      message: 'Registration submitted successfully'
    });

  } catch (error) {
    console.error('💥 Summit registration error:', error);
    res.status(500).json({
      error: 'Failed to submit registration',
      details: error.message
    });
  }
}
