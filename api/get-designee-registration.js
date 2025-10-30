export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const notionToken = process.env.NOTION_TOKEN;
  const summitRegistrationsDbId = process.env.NOTION_SUMMIT_REGISTRATIONS_DB_ID;
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;

  if (!notionToken || !summitRegistrationsDbId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }

  try {
    const { token } = req.query;

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log('🔍 Loading designee registration for token:', token.substring(0, 20) + '...');

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
          rich_text: { equals: token }
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
      res.status(403).json({ error: 'This registration link has expired. Please contact your primary member for a new link.' });
      return;
    }

    // Step 3: Get organization info
    const orgRelation = registration.properties["Organization"]?.relation?.[0]?.id;
    let organizationName = 'Unknown Organization';
    let primaryMemberName = 'Unknown Primary Member';

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

      // Try to get primary contact name from the organization
      const primaryContactRelation = orgData.properties["Primary Contact"]?.relation?.[0]?.id;
      if (primaryContactRelation) {
        const contactResponse = await fetch(`https://api.notion.com/v1/pages/${primaryContactRelation}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28'
          }
        });

        const contactData = await contactResponse.json();
        primaryMemberName = contactData.properties.Name?.title?.[0]?.text?.content || primaryMemberName;
      }
    }

    // Step 4: Get designee contact info
    const designeeRelation = registration.properties["Designee Contact"]?.relation?.[0]?.id;
    let designeeName = 'Unknown Designee';

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
    }

    // Step 5: Get attendance format
    const attendanceFormat = registration.properties["Designee Attendance Format"]?.select?.name?.toLowerCase() || 'in-person';

    // Step 6: Check if already completed
    const alreadyCompleted = registration.properties["Designee Registration Complete"]?.checkbox || false;

    console.log('✅ Loaded designee data for:', designeeName);

    res.status(200).json({
      registrationId: registration.id,
      designeeName: designeeName,
      institutionName: organizationName,
      primaryMemberName: primaryMemberName,
      attendanceFormat: attendanceFormat.includes('virtual') ? 'virtual' : 'in-person',
      alreadyCompleted: alreadyCompleted
    });

  } catch (error) {
    console.error('💥 Error loading designee registration:', error);
    res.status(500).json({
      error: 'Failed to load registration',
      details: error.message
    });
  }
}
