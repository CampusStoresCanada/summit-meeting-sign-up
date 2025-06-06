// api/get-organization-contacts.js - Get all contacts for an organization
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: `Method ${req.method} not allowed, expected GET` });
    return;
  }
  
  const token = req.query.token;
  
  if (!token) {
    res.status(400).json({ error: 'Token is required' });
    return;
  }
  
  // Use environment variables (should work now!)
  const notionToken = process.env.NOTION_TOKEN;
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;
  
  // Safety check
  if (!notionToken || !organizationsDbId || !contactsDbId) {
    console.error('❌ Missing environment variables!');
    console.error('- NOTION_TOKEN:', !!notionToken);
    console.error('- NOTION_ORGANIZATIONS_DB_ID:', !!organizationsDbId);
    console.error('- NOTION_CONTACTS_DB_ID:', !!contactsDbId);
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }
  
  try {
    console.log('🔍 Looking up organization for token:', token);
    
    // Step 1: Get the organization from the token
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
          rich_text: {
            equals: token
          }
        }
      })
    });
    
    if (!orgResponse.ok) {
      throw new Error(`Organization lookup failed: ${orgResponse.status}`);
    }
    
    const orgData = await orgResponse.json();
    
    if (orgData.results.length === 0) {
      res.status(404).json({ error: 'Organization not found for token' });
      return;
    }
    
    const org = orgData.results[0];
    const organizationName = org.properties.Organization?.title?.[0]?.text?.content || '';
    const organizationId = org.id; // This is the key! Use the relation ID
    
    console.log('🏢 Found organization:', organizationName);
    console.log('🔍 Organization ID for relation:', organizationId);
    
    // Step 2: Get contacts where Organization relation = this org ID
    console.log('👥 Fetching contacts for organization...');
    
    const contactsResponse = await fetch(`https://api.notion.com/v1/databases/${contactsDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          property: 'Organization',
          relation: {
            contains: organizationId
          }
        }
      })
    });
    
    if (!contactsResponse.ok) {
      throw new Error(`Contacts lookup failed: ${contactsResponse.status}`);
    }
    
    const contactsData = await contactsResponse.json();
    
    console.log(`📋 Found ${contactsData.results.length} contacts for ${organizationName}`);
    
    // Step 3: Format the contacts data
    const contacts = contactsData.results.map(contact => {
      const props = contact.properties;
      return {
        id: contact.id,
        name: props.Name?.title?.[0]?.text?.content || 'Unknown Name',
        firstName: props['First Name']?.rich_text?.[0]?.text?.content || '',
        workEmail: props['Work Email']?.email || '',
        workPhone: props['Work Phone Number']?.phone_number || '',
        roleTitle: props['Role/Title']?.rich_text?.[0]?.text?.content || '',
        contactType: props['Contact Type']?.select?.name || '',
        tags: props.Tags?.multi_select?.map(tag => tag.name) || [],
        notes: props.Notes?.rich_text?.[0]?.text?.content || '',
        // Add fields we might need for conference tracking
        isAttending: false, // We'll track this separately
        isPrimaryContact: false // We'll track this separately
      };
    });
    
    // Filter out contacts without basic info
    const validContacts = contacts.filter(contact => 
      contact.name && contact.name !== 'Unknown Name' && 
      (contact.workEmail || contact.workPhone)
    );
    
    console.log(`✅ Returning ${validContacts.length} valid contacts`);
    
    res.status(200).json({
      success: true,
      organizationName: organizationName,
      contacts: validContacts,
      totalFound: contactsData.results.length,
      validContacts: validContacts.length
    });
    
  } catch (error) {
    console.error('💥 Error fetching organization contacts:', error);
    res.status(500).json({ 
      error: 'Failed to fetch contacts', 
      details: error.message 
    });
  }
}
