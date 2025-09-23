// api/get-organization-contacts.js - Get all contacts for an organization
export default async function handler(req, res) {
  console.log('🚀 API called: get-organization-contacts');
  console.log('📥 Request method:', req.method);
  console.log('📥 Request query:', req.query);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('✅ OPTIONS request handled');
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    console.log('❌ Wrong method:', req.method);
    res.status(405).json({ error: `Method ${req.method} not allowed, expected GET` });
    return;
  }

  const token = req.query.token;
  console.log('🔑 Token received:', token);

  if (!token) {
    console.log('❌ No token provided');
    res.status(400).json({ error: 'Token is required' });
    return;
  }
  
  // Use environment variables
  const notionToken = process.env.NOTION_TOKEN;
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;
  const tagSystemDbId = process.env.NOTION_TAG_SYSTEM_DB_ID || '1f9a69bf0cfd8034b919f51b7c4f2c67';
  
  // Safety check
  if (!notionToken || !organizationsDbId || !contactsDbId) {
    console.error('❌ Missing environment variables!');
    console.error('NOTION_TOKEN:', notionToken ? 'SET' : 'MISSING');
    console.error('NOTION_ORGANIZATIONS_DB_ID:', organizationsDbId ? 'SET' : 'MISSING');
    console.error('NOTION_CONTACTS_DB_ID:', contactsDbId ? 'SET' : 'MISSING');
    res.status(500).json({
      error: 'Missing configuration',
      details: {
        notionToken: notionToken ? 'SET' : 'MISSING',
        organizationsDbId: organizationsDbId ? 'SET' : 'MISSING',
        contactsDbId: contactsDbId ? 'SET' : 'MISSING'
      }
    });
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
      const errorText = await orgResponse.text();
      console.error('❌ Organization lookup failed:', {
        status: orgResponse.status,
        statusText: orgResponse.statusText,
        response: errorText
      });
      throw new Error(`Organization lookup failed: ${orgResponse.status} - ${errorText}`);
    }
    
    const orgData = await orgResponse.json();
    
    if (orgData.results.length === 0) {
      res.status(404).json({ error: 'Organization not found for token' });
      return;
    }
    
    const org = orgData.results[0];
    const organizationName = org.properties.Organization?.title?.[0]?.text?.content || '';
    const organizationId = org.id;
    
    console.log('🏢 Found organization:', organizationName);
    console.log('🔍 Organization ID for relation:', organizationId);
    
    // Step 2: Get the "Primary Contact" tag ID from Tag System
    console.log('🏷️ Looking up Primary Contact tag...');
    let primaryContactTagId = null;
    
    try {
      const tagResponse = await fetch(`https://api.notion.com/v1/databases/${tagSystemDbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          filter: {
            property: 'Name',
            title: { equals: 'Primary Contact' }
          }
        })
      });
      
      if (tagResponse.ok) {
        const tagData = await tagResponse.json();
        if (tagData.results.length > 0) {
          primaryContactTagId = tagData.results[0].id;
          console.log('✅ Found Primary Contact tag ID:', primaryContactTagId);
        } else {
          console.log('⚠️ No "Primary Contact" tag found in Tag System database');
        }
      } else {
        console.error('❌ Failed to query Tag System database:', tagResponse.status);
      }
    } catch (error) {
      console.error('💥 Error finding Primary Contact tag:', error);
    }
    
    // Step 3: Get contacts where Organization relation = this org ID
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
      const errorText = await contactsResponse.text();
      console.error('❌ Contacts lookup failed:', {
        status: contactsResponse.status,
        statusText: contactsResponse.statusText,
        response: errorText
      });
      throw new Error(`Contacts lookup failed: ${contactsResponse.status} - ${errorText}`);
    }
    
    const contactsData = await contactsResponse.json();
    console.log(`📋 Found ${contactsData.results.length} contacts for ${organizationName}`);
    
    // Step 4: Format the contacts data and check for Primary Contact tag
    const contacts = contactsData.results.map(contact => {
      const props = contact.properties;
      
      // Check if this contact has the Primary Contact tag
      let isPrimaryContact = false;
      if (primaryContactTagId && props['Personal Tag']?.relation) {
        // Check if any of the related tags match our Primary Contact tag ID
        isPrimaryContact = props['Personal Tag'].relation.some(tag => tag.id === primaryContactTagId);
        
        if (isPrimaryContact) {
          console.log(`👑 Found primary contact: ${props.Name?.title?.[0]?.text?.content}`);
        }
      }
      
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
        dietaryRestrictions: props['Dietary Restrictions']?.rich_text?.[0]?.text?.content || '',
        isAttending: false,
        isPrimaryContact: isPrimaryContact
      };
    });
    
    // Filter out contacts without basic info
    const validContacts = contacts.filter(contact => 
      contact.name && contact.name !== 'Unknown Name' && 
      (contact.workEmail || contact.workPhone)
    );
    
    // Count primary contacts for debugging
    const primaryContactsCount = validContacts.filter(c => c.isPrimaryContact).length;
    console.log(`👑 Found ${primaryContactsCount} primary contacts`);
    
    console.log(`✅ Returning ${validContacts.length} valid contacts`);
    
    res.status(200).json({
      success: true,
      organizationName: organizationName,
      contacts: validContacts,
      totalFound: contactsData.results.length,
      validContacts: validContacts.length,
      primaryContactsFound: primaryContactsCount
    });
    
  } catch (error) {
    console.error('💥 Error fetching organization contacts:', error);
    console.error('💥 Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to fetch contacts',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
