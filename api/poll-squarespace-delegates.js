// api/poll-squarespace-delegates.js - Poll Squarespace for new delegate orders
// This runs every 5 minutes via Vercel cron

import { sendErrorNotification } from './lib/ses-mailer.js';

export default async function handler(req, res) {
  console.log('🔄 Starting Squarespace delegate order polling...');

  const apiKey = process.env.SQUARESPACE_API_KEY;
  const notionToken = process.env.NOTION_TOKEN;
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;
  const tagSystemDbId = process.env.NOTION_TAG_SYSTEM_DB_ID;

  if (!apiKey) {
    console.error('❌ Missing Squarespace API key');
    res.status(500).json({ error: 'Squarespace API key not configured' });
    return;
  }

  if (!notionToken || !contactsDbId || !tagSystemDbId) {
    console.error('❌ Missing Notion credentials');
    res.status(500).json({ error: 'Notion credentials not configured' });
    return;
  }

  try {
    // Fetch recent orders (last 24 hours to be safe)
    const now = new Date();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const modifiedAfter = since.toISOString();
    const modifiedBefore = now.toISOString();

    console.log(`📦 Fetching orders between: ${modifiedAfter} and ${modifiedBefore}`);

    const ordersResponse = await fetch(
      `https://api.squarespace.com/1.0/commerce/orders?modifiedAfter=${modifiedAfter}&modifiedBefore=${modifiedBefore}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'CSC-Membership-System/1.0'
        }
      }
    );

    if (!ordersResponse.ok) {
      const errorText = await ordersResponse.text();
      console.error('❌ Failed to fetch orders:', ordersResponse.status, errorText);
      res.status(500).json({
        error: 'Failed to fetch orders',
        details: errorText
      });
      return;
    }

    const ordersData = await ordersResponse.json();
    const orders = ordersData.result || [];

    console.log(`📋 Found ${orders.length} recent orders`);

    // Filter for orders with SKU 26999 (Conference Delegate Registration)
    const delegateOrders = [];

    for (const order of orders) {
      const lineItems = order.lineItems || [];
      const hasDelegateRegistration = lineItems.some(item =>
        item.sku === '26999' || item.productId === '26999'
      );

      if (hasDelegateRegistration) {
        delegateOrders.push(order);
      }
    }

    console.log(`👥 Found ${delegateOrders.length} orders with delegate registrations`);

    if (delegateOrders.length === 0) {
      res.status(200).json({
        success: true,
        message: 'No new delegate orders to process',
        ordersChecked: orders.length
      });
      return;
    }

    // Get processed order IDs from Notion (to avoid duplicates)
    const processedOrderIds = await getProcessedOrderIds(notionToken, contactsDbId);
    console.log(`📝 Already processed ${processedOrderIds.size} orders`);

    // Get tag IDs we'll need
    const conferenceDelegateTag = await findTagByName('26 Conference Delegate', notionToken, tagSystemDbId);
    const firstConferenceTag = await findTagByName('First Conference', notionToken, tagSystemDbId);

    if (!conferenceDelegateTag) {
      console.error('❌ "26 Conference Delegate" tag not found in Tag System');
      await sendErrorNotification({
        subject: 'CRITICAL: Squarespace Polling - Delegate Tag Missing',
        body: `The "26 Conference Delegate" tag was not found in the Notion Tag System database.\n\nThis will cause ALL delegate registration processing to fail!\n\nAction Required:\nCreate "26 Conference Delegate" tag in Tag System database.`
      });
      res.status(500).json({ error: 'Conference delegate tag not found' });
      return;
    }

    let processedCount = 0;
    let skippedCount = 0;
    let errors = [];

    // Process each order
    for (const order of delegateOrders) {
      const orderId = order.id;
      const orderNumber = order.orderNumber?.toString() || orderId;

      // Skip if already processed (check by order number)
      if (processedOrderIds.has(orderNumber)) {
        console.log(`⏭️ Skipping already processed order: ${orderNumber}`);
        skippedCount++;
        continue;
      }

      console.log(`\n📦 Processing order: ${orderNumber} (ID: ${orderId})`);
      console.log(`🔍 DEBUG - Order number: ${order.orderNumber || 'N/A'}`);
      console.log(`🔍 DEBUG - Full order keys:`, Object.keys(order));

      try {
        // Extract delegate registrations from line items
        const lineItems = order.lineItems || [];
        const delegateItems = lineItems.filter(item =>
          item.sku === '26999' || item.productId === '26999'
        );

        console.log(`👥 Found ${delegateItems.length} delegate registration(s) in order ${orderId}`);

        // Process each delegate registration
        for (const registration of delegateItems) {
          try {
            // Extract form data from customizations array
            const customizations = registration.customizations || [];

            // Helper function to find value by label
            const getCustomizationValue = (label) => {
              const item = customizations.find(c => c.label === label);
              return item ? item.value : '';
            };

            const delegateInfo = {
              name: getCustomizationValue('Name'),
              email: getCustomizationValue('Email'),
              institution: getCustomizationValue('Institution'),
              jobTitle: getCustomizationValue('Job Title'),
              phone: getCustomizationValue('Direct Phone'),
              dietaryRestrictions: getCustomizationValue('Do you have any dietary restrictions we need to know about?'),
              consentRecording: getCustomizationValue('Waiver'),
              firstConference: getCustomizationValue('Is this your first CSC conference?'),
              canCollMember: getCustomizationValue('Is your school a member of CANCOLL?'),
              orderId: orderId, // Store order ID with contact
              orderNumber: order.orderNumber || orderId // Use human-readable order number if available
            };

            console.log(`👤 Processing delegate: ${delegateInfo.name} (${delegateInfo.email})`);

            if (!delegateInfo.email) {
              console.error('❌ No email provided for delegate, skipping');
              errors.push(`Order ${orderId}: No email for delegate ${delegateInfo.name}`);
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
            errors.push(`Order ${orderId} - ${registration.productName || 'Unknown'}: ${error.message}`);
          }
        }

      } catch (error) {
        console.error(`❌ Error processing order ${orderId}:`, error);
        errors.push(`Order ${orderId}: ${error.message}`);
      }
    }

    console.log(`\n✅ Polling complete: ${processedCount} delegates processed, ${skippedCount} orders skipped`);

    if (errors.length > 0) {
      console.log('⚠️ Errors encountered:', errors);
      await sendErrorNotification({
        subject: 'Squarespace Delegate Polling - Partial Errors',
        body: `Some delegate registrations failed to process.\n\nProcessed: ${processedCount} delegates\nSkipped: ${skippedCount} orders (already processed)\nErrors: ${errors.length}\n\nErrors:\n${errors.join('\n')}\n\nAction Required:\nManually add these delegates to Notion.`
      });
    }

    res.status(200).json({
      success: true,
      ordersChecked: orders.length,
      delegateOrders: delegateOrders.length,
      delegatesProcessed: processedCount,
      ordersSkipped: skippedCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('💥 Polling error:', error);

    await sendErrorNotification({
      subject: 'Squarespace Polling - Processing Error',
      body: `An error occurred while polling for delegate registrations.\n\nError: ${error.message}\n\nStack trace:\n${error.stack}\n\nAction Required:\nCheck Vercel logs for more details.`
    });

    res.status(500).json({
      error: 'Polling failed',
      details: error.message
    });
  }
}

// Get list of already-processed order IDs from Notion contacts
async function getProcessedOrderIds(notionToken, contactsDbId) {
  const processedIds = new Set();

  // Query contacts that have "Squarespace Order ID" property
  // We'll check the last 100 contacts to avoid processing duplicates
  const response = await fetch(`https://api.notion.com/v1/databases/${contactsDbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      page_size: 100,
      sorts: [
        {
          timestamp: 'last_edited_time',
          direction: 'descending'
        }
      ]
    })
  });

  if (!response.ok) {
    console.warn('⚠️ Failed to fetch processed orders, will process all');
    return processedIds;
  }

  const data = await response.json();

  for (const page of data.results) {
    const orderNumber = page.properties['Conference Order ID']?.rich_text?.[0]?.text?.content;
    if (orderNumber) {
      processedIds.add(orderNumber);
    }
  }

  return processedIds;
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
        property: 'Work Email',
        email: {
          equals: delegateInfo.email.toLowerCase()
        }
      }
    })
  });

  if (!searchResponse.ok) {
    const errorText = await searchResponse.text();
    console.error(`❌ Notion search failed: ${searchResponse.status}`, errorText);
    throw new Error(`Failed to search for contact: ${searchResponse.status} - ${errorText}`);
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
          'Work Email': {
            email: delegateInfo.email.toLowerCase()
          },
          'Role/Title': {
            rich_text: [
              {
                text: {
                  content: delegateInfo.jobTitle
                }
              }
            ]
          },
          'Work Phone Number': {
            phone_number: delegateInfo.phone
          },
          'Notes': {
            rich_text: [
              {
                text: {
                  content: `Institution: ${delegateInfo.institution}\nRegistered via Squarespace for conference.`
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
          },
          'Conference Order ID': {
            rich_text: [
              {
                text: {
                  content: delegateInfo.orderNumber
                }
              }
            ]
          }
        }
      })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`❌ Notion update failed: ${updateResponse.status}`, errorText);
      throw new Error(`Failed to update contact: ${updateResponse.status} - ${errorText}`);
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
        'Work Email': {
          email: delegateInfo.email.toLowerCase()
        },
        'Role/Title': {
          rich_text: [
            {
              text: {
                content: delegateInfo.jobTitle
              }
            }
          ]
        },
        'Work Phone Number': {
          phone_number: delegateInfo.phone
        },
        'Notes': {
          rich_text: [
            {
              text: {
                content: `Institution: ${delegateInfo.institution}\nRegistered via Squarespace for conference.`
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
        },
        'Conference Order ID': {
          rich_text: [
            {
              text: {
                content: delegateInfo.orderNumber
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
  const existingTags = pageData.properties['Personal Tag']?.relation || [];

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
        'Personal Tag': {
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

// Helper to check if a form response indicates "yes" or first time attendance
function isYesResponse(value) {
  if (!value) return false;
  const normalized = value.toString().toLowerCase().trim();
  // Check for various affirmative responses
  return normalized === 'yes' ||
         normalized === 'true' ||
         normalized === '1' ||
         normalized.includes('first time') ||
         normalized.includes('would like a ribbon');
}
