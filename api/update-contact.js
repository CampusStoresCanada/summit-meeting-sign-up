// api/update-contact.js - Update a contact's details in Notion
export default async function handler(req, res) {
  console.log('🚀 API called: update-contact');
  console.log('📥 Request method:', req.method);

  res.setHeader('Access-Control-Allow-Origin', 'https://membershiprenewal.campusstores.ca');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('✅ OPTIONS request handled');
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    console.log('❌ Wrong method:', req.method);
    res.status(405).json({ error: `Method ${req.method} not allowed, expected POST` });
    return;
  }

  const { contactId, updates } = req.body;
  console.log('📝 Contact ID:', contactId);
  console.log('📝 Updates:', updates);

  if (!contactId) {
    console.log('❌ No contact ID provided');
    res.status(400).json({ error: 'Contact ID is required' });
    return;
  }

  if (!updates || Object.keys(updates).length === 0) {
    console.log('❌ No updates provided');
    res.status(400).json({ error: 'Updates object is required' });
    return;
  }

  // Use environment variables
  const notionToken = process.env.NOTION_TOKEN;

  if (!notionToken) {
    console.error('❌ Missing NOTION_TOKEN environment variable!');
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }

  try {
    // Build the Notion properties object
    const properties = {};

    if (updates.name) {
      properties['Name'] = {
        title: [
          {
            text: {
              content: updates.name
            }
          }
        ]
      };
    }

    if (updates.roleTitle !== undefined) {
      properties['Role/Title'] = {
        rich_text: [
          {
            text: {
              content: updates.roleTitle
            }
          }
        ]
      };
    }

    if (updates.workEmail !== undefined) {
      properties['Work Email'] = {
        email: updates.workEmail
      };
    }

    if (updates.workPhone !== undefined) {
      properties['Work Phone Number'] = {
        phone_number: updates.workPhone
      };
    }

    console.log('🔄 Updating contact in Notion...');

    // Update the contact page in Notion
    const response = await fetch(`https://api.notion.com/v1/pages/${contactId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: properties
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Notion API error:', errorData);
      res.status(response.status).json({
        error: 'Failed to update contact in Notion',
        details: errorData
      });
      return;
    }

    const updatedContact = await response.json();
    console.log('✅ Contact updated successfully:', updatedContact.id);

    res.status(200).json({
      success: true,
      message: 'Contact updated successfully',
      contactId: updatedContact.id
    });

  } catch (error) {
    console.error('❌ Error updating contact:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
