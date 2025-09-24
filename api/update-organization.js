// api/update-organization.js - Update organization details in Notion
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

  if (!notionToken || !organizationsDbId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }

  try {
    const { token, organizationUpdates } = req.body;

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log('🏢 Processing organization updates for token:', token);
    console.log('📝 Updates to apply:', JSON.stringify(organizationUpdates, null, 2));

    // Step 1: Find the organization by token
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
    const organizationId = org.id;
    const organizationName = org.properties.Organization?.title?.[0]?.text?.content || '';

    console.log(`🎯 Found organization: ${organizationName} (${organizationId})`);

    // Step 2: Build update payload
    const updateData = {
      properties: {}
    };

    // Update organization name
    if (organizationUpdates.institutionName) {
      updateData.properties["Organization"] = {
        title: [{ text: { content: organizationUpdates.institutionName } }]
      };
      console.log(`📝 Updating name: ${organizationName} → ${organizationUpdates.institutionName}`);
    }

    // Update website
    if (organizationUpdates.website) {
      updateData.properties["Website"] = {
        url: organizationUpdates.website
      };
      console.log(`🌐 Updating website: ${organizationUpdates.website}`);
    }

    // Update institution size
    if (organizationUpdates.institutionSize) {
      updateData.properties["Institution Size"] = {
        select: { name: organizationUpdates.institutionSize }
      };
      console.log(`📊 Updating institution size: ${organizationUpdates.institutionSize}`);
    }

    // Update address fields
    if (organizationUpdates.address) {
      const address = organizationUpdates.address;

      if (address.streetAddress) {
        updateData.properties["Street Address"] = {
          rich_text: [{ text: { content: address.streetAddress } }]
        };
      }

      if (address.city) {
        updateData.properties["City"] = {
          rich_text: [{ text: { content: address.city } }]
        };
      }

      if (address.province) {
        updateData.properties["Province"] = {
          select: { name: address.province }
        };
      }

      if (address.postalCode) {
        updateData.properties["Postal Code"] = {
          rich_text: [{ text: { content: address.postalCode } }]
        };
      }

      console.log(`🏠 Updating address: ${address.streetAddress}, ${address.city}, ${address.province} ${address.postalCode}`);
    }

    // Step 3: Apply updates to Notion
    if (Object.keys(updateData.properties).length === 0) {
      console.log('ℹ️ No updates to apply');
      res.status(200).json({
        success: true,
        message: 'No changes detected',
        organizationId: organizationId
      });
      return;
    }

    console.log('📤 Sending updates to Notion:', JSON.stringify(updateData, null, 2));

    const updateResponse = await fetch(`https://api.notion.com/v1/pages/${organizationId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(updateData)
    });

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      console.error('❌ Notion update failed:', errorData);
      throw new Error(`Notion API error: ${errorData.message}`);
    }

    const updatedOrg = await updateResponse.json();
    console.log('✅ Organization updated successfully in Notion');

    res.status(200).json({
      success: true,
      organizationId: organizationId,
      updatedProperties: Object.keys(updateData.properties),
      message: `Updated ${Object.keys(updateData.properties).length} organization properties`
    });

  } catch (error) {
    console.error('💥 Error updating organization:', error);
    res.status(500).json({
      error: 'Failed to update organization',
      details: error.message
    });
  }
}