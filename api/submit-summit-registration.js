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
  const tagSystemDbId = process.env.NOTION_TAG_SYSTEM_DB_ID || '1f9a69bf0cfd8034b919f51b7c4f2c67';

  if (!notionToken || !organizationsDbId || !contactsDbId || !summitRegistrationsDbId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }

  // DIAGNOSTIC MODE: Check if this is a schema query request
  if (req.body && req.body.diagnosticMode === 'getSchema') {
    console.log('🔍 DIAGNOSTIC MODE: Fetching database schema...');
    try {
      const schemaResponse = await fetch(`https://api.notion.com/v1/databases/${summitRegistrationsDbId}`, {
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28'
        }
      });

      const schemaData = await schemaResponse.json();

      if (!schemaResponse.ok) {
        console.error('❌ Failed to get schema:', schemaData);
        res.status(schemaResponse.status).json({
          error: 'Failed to get database schema',
          details: schemaData
        });
        return;
      }

      // Extract property names and types
      const properties = {};
      for (const [name, prop] of Object.entries(schemaData.properties)) {
        properties[name] = prop.type;
      }

      console.log('✅ Database schema retrieved successfully');
      console.log('Properties:', JSON.stringify(properties, null, 2));

      res.status(200).json({
        databaseTitle: schemaData.title?.[0]?.plain_text || 'Unknown',
        databaseId: summitRegistrationsDbId,
        properties: properties,
        propertyCount: Object.keys(properties).length,
        fullSchema: schemaData
      });
      return;
    } catch (error) {
      console.error('💥 Schema fetch error:', error);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  try {
    const {
      token,
      organizationId,
      primaryContactId,
      primaryIsAttending,
      primaryFormat,
      tlpRedSignatureUrl,
      employmentSignatureUrl,
      virtualProtocolSignatureUrl,
      hasDesignee,
      designees, // Array of {contact, format, isNew}
      certificationUrl
    } = req.body;

    console.log('🔍 Summit registration submission for token:', token);
    console.log('📊 Registration data:', {
      primaryIsAttending,
      primaryFormat,
      hasDesignee,
      designeeCount: designees?.length || 0,
      primaryContactId: primaryContactId ? 'provided' : 'missing'
    });

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

    // Step 2: Get summit tag IDs
    console.log('🏷️ Looking up summit tags...');
    let summitInPersonTagId = null;
    let summitOnlineTagId = null;

    try {
      // Get "26 Summit - In-Person" tag
      const inPersonTagResponse = await fetch(`https://api.notion.com/v1/databases/${tagSystemDbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          filter: {
            property: 'Name',
            title: { equals: '26 Summit - In-Person' }
          }
        })
      });

      if (inPersonTagResponse.ok) {
        const inPersonTagData = await inPersonTagResponse.json();
        if (inPersonTagData.results.length > 0) {
          summitInPersonTagId = inPersonTagData.results[0].id;
          console.log('✅ Found 26 Summit - In-Person tag ID:', summitInPersonTagId);
        }
      }

      // Get "26 Summit - Online" tag
      const onlineTagResponse = await fetch(`https://api.notion.com/v1/databases/${tagSystemDbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          filter: {
            property: 'Name',
            title: { equals: '26 Summit - Online' }
          }
        })
      });

      if (onlineTagResponse.ok) {
        const onlineTagData = await onlineTagResponse.json();
        if (onlineTagData.results.length > 0) {
          summitOnlineTagId = onlineTagData.results[0].id;
          console.log('✅ Found 26 Summit - Online tag ID:', summitOnlineTagId);
        }
      }

    } catch (error) {
      console.error('💥 Error finding summit tags:', error);
    }

    // Step 3: Check if registration already exists
    // NOTE: Temporarily skipping this check due to database access issues
    // Will always create new registrations for now
    console.log('📋 Skipping existing registration check, will create new registration');
    const existingRegistration = null;

    // Step 4: Process each designee contact and generate tokens
    const processedDesignees = [];

    if (hasDesignee && designees && designees.length > 0) {
      console.log(`📋 Processing ${designees.length} designee(s)...`);

      for (const designeeData of designees) {
        const { contact, format, isNew } = designeeData;
        let contactId = null;

        if (isNew) {
          // Create new contact
          console.log('➕ Creating new designee contact:', contact.name);

          const contactData = {
            parent: { database_id: contactsDbId },
            properties: {
              "Name": {
                title: [{ text: { content: contact.name } }]
              },
              "First Name": {
                rich_text: [{ text: { content: contact.name.split(' ')[0] || '' } }]
              },
              "Work Email": {
                email: contact.email
              },
              "Work Phone Number": {
                phone_number: contact.phone || null
              },
              "Role/Title": {
                rich_text: [{ text: { content: contact.title || '' } }]
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
            contactId = createdContact.id;
            console.log(`✅ Created designee contact: ${contact.name}`);
          } else {
            const errorData = await createContactResponse.json();
            console.error('❌ Failed to create designee contact:', errorData);
            throw new Error(`Failed to create designee contact: ${contact.name}`);
          }
        } else {
          // Use existing contact
          contactId = contact.id;
          console.log('✅ Using existing designee contact:', contact.name);
        }

        // Generate token for this designee
        const token = `designee-${crypto.randomBytes(32).toString('hex')}`;
        const expiresDate = new Date();
        expiresDate.setDate(expiresDate.getDate() + 14);
        const tokenExpires = expiresDate.toISOString();

        console.log(`🔑 Generated token for ${contact.name}: ${token.substring(0, 30)}...`);

        processedDesignees.push({
          contact,
          contactId,
          token,
          tokenExpires,
          format
        });
      }
    }

    // Step 5: Build registration properties
    const registrationProperties = {
      "Organization": {
        relation: [{ id: orgId }]
      },
      "Primary Is Attending": {
        checkbox: primaryIsAttending
      },
      "Primary Attendance Format": {
        select: primaryIsAttending ? { name: primaryFormat === 'in-person' ? 'In-Person' : 'Virtual' } : { name: 'Not Attending' }
      },
      "Primary Breach Acknowledgement": {
        checkbox: true
      },
      "Has Designee": {
        checkbox: hasDesignee
      },
      "Updated At": {
        date: { start: new Date().toISOString() }
      }
    };

    // Add primary contact relation if provided
    if (primaryContactId) {
      registrationProperties["Primary Contact"] = {
        relation: [{ id: primaryContactId }]
      };
    }

    // Add signature URLs if attending
    if (primaryIsAttending) {
      if (tlpRedSignatureUrl) {
        registrationProperties["Primary Agreement URL"] = {
          url: tlpRedSignatureUrl
        };
      }
    }

    // Add virtual protocol if virtual
    if (primaryIsAttending && primaryFormat === 'virtual') {
      registrationProperties["Primary Virtual Protocol Acknowledged"] = {
        checkbox: true
      };
    }

    // Add certification URL if designees exist
    if (hasDesignee && certificationUrl) {
      registrationProperties["Primary Certification URL"] = {
        url: certificationUrl
      };
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

    // Step 7: Tag contacts with summit tags
    console.log('🏷️ Tagging contacts...');

    // Tag primary member if attending
    if (primaryIsAttending && primaryContactId && (summitInPersonTagId || summitOnlineTagId)) {
      try {
        const tagId = primaryFormat === 'in-person' ? summitInPersonTagId : summitOnlineTagId;
        const tagName = primaryFormat === 'in-person' ? '26 Summit - In-Person' : '26 Summit - Online';

        if (tagId) {
          // Get current contact to preserve existing tags
          const contactResponse = await fetch(`https://api.notion.com/v1/pages/${primaryContactId}`, {
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Notion-Version': '2022-06-28'
            }
          });

          if (contactResponse.ok) {
            const contactData = await contactResponse.json();
            const existingTags = contactData.properties['Personal Tag']?.relation || [];

            // Check if tag already exists
            const hasTag = existingTags.some(tag => tag.id === tagId);

            if (!hasTag) {
              // Add new tag to existing tags
              const updatedTags = [...existingTags, { id: tagId }];

              await fetch(`https://api.notion.com/v1/pages/${primaryContactId}`, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${notionToken}`,
                  'Content-Type': 'application/json',
                  'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                  properties: {
                    'Personal Tag': {
                      relation: updatedTags
                    }
                  }
                })
              });

              console.log(`✅ Tagged primary contact with ${tagName}`);
            } else {
              console.log(`ℹ️ Primary contact already has ${tagName} tag`);
            }
          }
        }
      } catch (error) {
        console.error('💥 Error tagging primary contact:', error);
        // Don't fail registration if tagging fails
      }
    }

    // Step 7.5: Create separate registration records for each designee
    const designeeRegistrationIds = [];

    for (const designee of processedDesignees) {
      try {
        console.log(`➕ Creating registration record for designee: ${designee.contact.name}`);

        const designeeRegId = `REG-DESIGNEE-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

        const designeeRegProperties = {
          "Registration ID": {
            title: [{ text: { content: designeeRegId } }]
          },
          "Organization": {
            relation: [{ id: orgId }]
          },
          "Designee Contact": {
            relation: [{ id: designee.contactId }]
          },
          "Designee Token": {
            rich_text: [{ text: { content: designee.token } }]
          },
          "Designee Token Expires": {
            date: { start: designee.tokenExpires }
          },
          "Designee Attendance Format": {
            select: { name: designee.format === 'in-person' ? 'In-Person' : 'Virtual' }
          },
          "Has Designee": {
            checkbox: false  // This IS the designee record
          },
          "Primary Is Attending": {
            checkbox: false  // Designee records don't have primary attendance
          },
          "Created At": {
            date: { start: new Date().toISOString() }
          },
          "Updated At": {
            date: { start: new Date().toISOString() }
          }
        };

        const createDesigneeRegResponse = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            parent: { database_id: summitRegistrationsDbId },
            properties: designeeRegProperties
          })
        });

        if (!createDesigneeRegResponse.ok) {
          const errorData = await createDesigneeRegResponse.json();
          console.error('❌ Failed to create designee registration:', errorData);
          throw new Error(`Failed to create designee registration for ${designee.contact.name}`);
        }

        const createdDesigneeReg = await createDesigneeRegResponse.json();
        designeeRegistrationIds.push(createdDesigneeReg.id);
        console.log(`✅ Created designee registration: ${designeeRegId}`);

      } catch (error) {
        console.error(`💥 Error creating designee registration for ${designee.contact.name}:`, error);
        throw error;
      }
    }

    // Tag designee contacts
    for (const designee of processedDesignees) {
      if (summitInPersonTagId || summitOnlineTagId) {
        try {
          const tagId = designee.format === 'in-person' ? summitInPersonTagId : summitOnlineTagId;
          const tagName = designee.format === 'in-person' ? '26 Summit - In-Person' : '26 Summit - Online';

          if (tagId) {
            // Get current contact to preserve existing tags
            const contactResponse = await fetch(`https://api.notion.com/v1/pages/${designee.contactId}`, {
              headers: {
                'Authorization': `Bearer ${notionToken}`,
                'Notion-Version': '2022-06-28'
              }
            });

            if (contactResponse.ok) {
              const contactData = await contactResponse.json();
              const existingTags = contactData.properties['Personal Tag']?.relation || [];

              // Check if tag already exists
              const hasTag = existingTags.some(tag => tag.id === tagId);

              if (!hasTag) {
                // Add new tag to existing tags
                const updatedTags = [...existingTags, { id: tagId }];

                await fetch(`https://api.notion.com/v1/pages/${designee.contactId}`, {
                  method: 'PATCH',
                  headers: {
                    'Authorization': `Bearer ${notionToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                  },
                  body: JSON.stringify({
                    properties: {
                      'Personal Tag': {
                        relation: updatedTags
                      }
                    }
                  })
                });

                console.log(`✅ Tagged ${designee.contact.name} with ${tagName}`);
              } else {
                console.log(`ℹ️ ${designee.contact.name} already has ${tagName} tag`);
              }
            }
          }
        } catch (error) {
          console.error(`💥 Error tagging ${designee.contact.name}:`, error);
          // Don't fail registration if tagging fails
        }
      }
    }

    // Step 8: Send designee invitation emails
    if (hasDesignee && processedDesignees.length > 0) {
      console.log(`📧 Sending invitation emails to ${processedDesignees.length} designee(s)...`);

      const { sendEmail } = await import('./lib/resend-mailer.js');
      const baseUrl = process.env.PRODUCTION_URL || 'https://summit26.campusstores.ca';

      for (let i = 0; i < processedDesignees.length; i++) {
        const designee = processedDesignees[i];
        const designeeRegId = designeeRegistrationIds[i];

        try {
          const designeeUrl = `${baseUrl}/?token=${designee.token}`;
          const designeeEmail = designee.contact.email || designee.contact.workEmail;

          console.log(`📧 Sending to ${designee.contact.name} (${designeeEmail})`);

          // Build email body
          const emailBody = `
            <h2>You've Been Designated to Attend the Managers & Directors Summit</h2>

            <p>Hello ${designee.contact.name},</p>

            <p>${organizationName} has designated you to attend the CSC Managers & Directors Summit.</p>

            <h3>Your Attendance Format:</h3>
            <p><strong>${designee.format === 'in-person' ? 'In-Person' : 'Virtual (Online)'}</strong></p>

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
          const emailResult = await sendEmail({
            to: designeeEmail,
            subject: `You've Been Designated for the CSC Managers & Directors Summit`,
            body: emailBody,
            from: process.env.AWS_SES_SENDER_EMAIL || 'noreply@campusstores.ca'
          });

          if (emailResult.success) {
            console.log(`✅ Invitation email sent to ${designee.contact.name}`);

            // Update designee registration with invitation sent timestamp
            await fetch(`https://api.notion.com/v1/pages/${designeeRegId}`, {
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
                  },
                  "Designee Invitation Sent": {
                    checkbox: true
                  }
                }
              })
            });
          } else {
            console.error(`⚠️ Failed to send email to ${designee.contact.name}:`, emailResult.error);
          }
        } catch (emailError) {
          console.error(`💥 Error sending email to ${designee.contact.name}:`, emailError);
          // Don't fail the whole registration if email fails
        }
      }
    }

    // Step 8: Send confirmation email to primary member
    console.log('📧 Sending confirmation email to primary member...');

    try {
      const { sendEmail } = await import('./lib/resend-mailer.js');

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

        if (hasDesignee && processedDesignees.length > 0) {
          if (processedDesignees.length === 1) {
            emailBody += `
              <li><strong>Designee:</strong> ${processedDesignees[0].contact.name}</li>
              <li><strong>Designee Attendance:</strong> ${processedDesignees[0].format === 'in-person' ? 'In-Person' : 'Virtual'}</li>
            `;
          } else {
            emailBody += `<li><strong>Designees:</strong></li>`;
            emailBody += `<ul>`;
            processedDesignees.forEach(d => {
              emailBody += `<li>${d.contact.name} - ${d.format === 'in-person' ? 'In-Person' : 'Virtual'}</li>`;
            });
            emailBody += `</ul>`;
          }
        }

        emailBody += `
          </ul>

          ${hasDesignee ? `
          <h3>Next Steps:</h3>
          <p>${processedDesignees.length === 1 ? processedDesignees[0].contact.name + ' will receive a' : 'Each of your designees will receive a'} separate email with a unique link to complete their confidentiality agreement. Their registration will be pending until they complete this step.</p>
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
      designeeTokens: processedDesignees.map(d => d.token),
      designeeCount: processedDesignees.length,
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
