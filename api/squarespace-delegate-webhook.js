// api/squarespace-delegate-webhook.js - Process conference delegate registrations from Squarespace
import { sendErrorNotification } from './lib/resend-mailer.js';

export default async function handler(req, res) {
  // Squarespace webhooks are always POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  console.log('📦 Received Squarespace order webhook');
  console.log('🔍 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📋 Body:', JSON.stringify(req.body, null, 2));

  try {
    // Verify webhook signature from Squarespace
    const signature = req.headers['squarespace-signature'];
    const webhookSecret = process.env.SQUARESPACE_WEBHOOK_SECRET;

    if (webhookSecret && signature) {
      const crypto = await import('crypto');
      const payload = JSON.stringify(req.body);
      const expectedSignature = crypto.createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');

      if (signature !== expectedSignature) {
        console.error('❌ Invalid webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      console.log('✅ Webhook signature verified');
    } else {
      console.warn('⚠️ Webhook signature not configured - skipping verification');
    }

    const notionToken = process.env.NOTION_TOKEN;
    const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;
    const tagSystemDbId = process.env.NOTION_TAG_SYSTEM_DB_ID;

    if (!notionToken || !contactsDbId || !tagSystemDbId) {
      console.error('❌ Missing Notion credentials');
      res.status(500).json({ error: 'Configuration error' });
      return;
    }

    // Parse Squarespace order data
    const order = req.body;

    // Extract line items from order
    const lineItems = order.lineItems || [];

    console.log(`📦 Processing order with ${lineItems.length} line items`);

    // Filter for conference delegate registrations (SKU 26999)
    const delegateRegistrations = lineItems.filter(item =>
      item.sku === '26999' || item.productId === '26999'
    );

    if (delegateRegistrations.length === 0) {
      console.log('⏭️ No delegate registrations in this order');
      res.status(200).json({
        received: true,
        message: 'No delegate registrations to process'
      });
      return;
    }

    console.log(`👥 Found ${delegateRegistrations.length} delegate registration(s)`);

    // Get tag IDs we'll need
    const conferenceDelegateTag = await findTagByName('26 Conference Delegate', notionToken, tagSystemDbId);
    const firstConferenceTag = await findTagByName('First Conference', notionToken, tagSystemDbId);

    if (!conferenceDelegateTag) {
      console.error('❌ "26 Conference Delegate" tag not found in Tag System');
      await sendErrorNotification({
        subject: 'CRITICAL: Squarespace Webhook - Delegate Tag Missing',
        body: `The "26 Conference Delegate" tag was not found in the Notion Tag System database.\n\nThis will cause ALL delegate registration webhooks to fail!\n\nAction Required:\nCreate "26 Conference Delegate" tag in Tag System database.`
      });
      res.status(500).json({ error: 'Conference delegate tag not found' });
      return;
    }

    let processedCount = 0;
    let errors = [];

    // Process each delegate registration
    for (const registration of delegateRegistrations) {
      try {
        // Extract form data from customizations/variantOptions
        // Squarespace might store this differently - adjust field names as needed
        const formData = registration.customizations || registration.variantOptions || {};

        const delegateInfo = {
          name: formData.name || formData.Name || '',
          email: formData.email || formData.Email || '',
          jobTitle: formData.jobTitle || formData['Job Title'] || '',
          dietaryRestrictions: formData.dietaryRestrictions || formData['Dietary Restrictions'] || '',
          consentRecording: formData.consentRecording || formData['Consent for Recording'] || '',
          firstConference: formData.firstConference || formData['First Conference'] || '',
          canCollMember: formData.canCollMember || formData['CanCOLL Member'] || ''
        };

        console.log(`\n👤 Processing delegate: ${delegateInfo.name} (${delegateInfo.email})`);

        if (!delegateInfo.email) {
          console.error('❌ No email provided for delegate, skipping');
          errors.push(`No email for delegate: ${delegateInfo.name}`);
          continue;
        }

        // Find or create contact in Notion
        const contact = await findOrCreateContact(delegateInfo, notionToken, contactsDbId);

        console.log(`✅ Contact ready: ${contact.id}`);

        // Add "26 Conference Delegate" tag
        await addTagToContact(contact.id, conferenceDelegateTag.id, notionToken);
        console.log(`✅ Added "26 Conference Delegate" tag`);

        // Add "First Conference" tag if applicable
        if (isYesResponse(delegateInfo.firstConference)) {
          if (firstConferenceTag) {
            await addTagToContact(contact.id, firstConferenceTag.id, notionToken);
            console.log(`✅ Added "First Conference" tag`);
          } else {
            console.warn('⚠️ "First Conference" tag not found, skipping');
          }
        }

        processedCount++;

      } catch (error) {
        console.error('❌ Error processing delegate:', error);
        errors.push(`${registration.name || 'Unknown'}: ${error.message}`);
      }
    }

    console.log(`\n✅ Webhook processing complete: ${processedCount}/${delegateRegistrations.length} delegates processed`);

    if (errors.length > 0) {
      console.log('⚠️ Errors encountered:', errors);
      await sendErrorNotification({
        subject: 'Squarespace Delegate Registration - Partial Errors',
        body: `Some delegate registrations failed to process.\n\nOrder ID: ${order.id || 'Unknown'}\nProcessed: ${processedCount}/${delegateRegistrations.length}\n\nErrors:\n${errors.join('\n')}\n\nAction Required:\nManually add these delegates to Notion.`
      });
    }

    res.status(200).json({
      received: true,
      processed: true,
      delegatesProcessed: processedCount,
      totalDelegates: delegateRegistrations.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('💥 Webhook processing error:', error);

    await sendErrorNotification({
      subject: 'Squarespace Webhook - Processing Error',
      body: `An error occurred while processing a delegate registration webhook.\n\nError: ${error.message}\n\nStack trace:\n${error.stack}\n\nAction Required:\nCheck Vercel logs for more details.`
    });

    res.status(500).json({
      error: 'Webhook processing failed',
      details: error.message
    });
  }
}

// Find a tag by name in the Tag System database
async function findTagByName(tagName, notionToken, tagSystemDbId) {
  const response = await fetch(`https://api.notion.com/v1/databases/${tagSystemDbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      filter: {
        property: 'Name',
        title: {
          equals: tagName
        }
      }
    })
  });

  if (!response.ok) {
    console.error(`❌ Failed to find tag "${tagName}": ${response.status}`);
    return null;
  }

  const data = await response.json();

  if (data.results.length === 0) {
    console.warn(`⚠️ Tag "${tagName}" not found in Tag System`);
    return null;
  }

  return data.results[0];
}

// Find existing contact by email, or create new contact
async function findOrCreateContact(delegateInfo, notionToken, contactsDbId) {
  // Search for existing contact by email
  const searchResponse = await fetch(`https://api.notion.com/v1/databases/${contactsDbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      filter: {
        property: 'Email',
        email: {
          equals: delegateInfo.email.toLowerCase()
        }
      }
    })
  });

  if (!searchResponse.ok) {
    throw new Error(`Failed to search for contact: ${searchResponse.status}`);
  }

  const searchData = await searchResponse.json();

  // Contact exists - update it
  if (searchData.results.length > 0) {
    const existingContact = searchData.results[0];
    console.log(`📝 Contact exists, updating: ${existingContact.id}`);

    const updateResponse = await fetch(`https://api.notion.com/v1/pages/${existingContact.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        properties: {
          'Name': {
            title: [
              {
                text: {
                  content: delegateInfo.name
                }
              }
            ]
          },
          'Email': {
            email: delegateInfo.email.toLowerCase()
          },
          'Job Title': {
            rich_text: [
              {
                text: {
                  content: delegateInfo.jobTitle
                }
              }
            ]
          },
          'Dietary Restrictions': {
            rich_text: [
              {
                text: {
                  content: delegateInfo.dietaryRestrictions
                }
              }
            ]
          }
        }
      })
    });

    if (!updateResponse.ok) {
      throw new Error(`Failed to update contact: ${updateResponse.status}`);
    }

    return await updateResponse.json();
  }

  // Contact doesn't exist - create it
  console.log(`➕ Creating new contact: ${delegateInfo.email}`);

  const createResponse = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      parent: {
        database_id: contactsDbId
      },
      properties: {
        'Name': {
          title: [
            {
              text: {
                content: delegateInfo.name
              }
            }
          ]
        },
        'Email': {
          email: delegateInfo.email.toLowerCase()
        },
        'Job Title': {
          rich_text: [
            {
              text: {
                content: delegateInfo.jobTitle
              }
            }
          ]
        },
        'Dietary Restrictions': {
          rich_text: [
            {
              text: {
                content: delegateInfo.dietaryRestrictions
              }
            }
          ]
        }
      }
    })
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Failed to create contact: ${createResponse.status} ${errorText}`);
  }

  return await createResponse.json();
}

// Add a tag to a contact (append to existing tags)
async function addTagToContact(contactId, tagId, notionToken) {
  // First, get existing tags
  const pageResponse = await fetch(`https://api.notion.com/v1/pages/${contactId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28'
    }
  });

  if (!pageResponse.ok) {
    throw new Error(`Failed to fetch contact page: ${pageResponse.status}`);
  }

  const pageData = await pageResponse.json();
  const existingTags = pageData.properties.Tag?.relation || [];

  // Check if tag already exists
  const hasTag = existingTags.some(tag => tag.id === tagId);

  if (hasTag) {
    console.log(`✅ Contact already has this tag, skipping`);
    return;
  }

  // Add new tag to existing tags
  const updateResponse = await fetch(`https://api.notion.com/v1/pages/${contactId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      properties: {
        'Tag': {
          relation: [
            ...existingTags,
            { id: tagId }
          ]
        }
      }
    })
  });

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    throw new Error(`Failed to add tag: ${updateResponse.status} ${errorText}`);
  }
}

// Helper to check if a form response is "yes"
function isYesResponse(value) {
  if (!value) return false;
  const normalized = value.toString().toLowerCase().trim();
  return normalized === 'yes' || normalized === 'true' || normalized === '1';
}
