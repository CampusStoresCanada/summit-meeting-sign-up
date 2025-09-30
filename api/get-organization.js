// api/get-organization.js - Get organization data for membership renewal
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

  const notionToken = process.env.NOTION_TOKEN;
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  const tagSystemDbId = process.env.NOTION_TAG_SYSTEM_DB_ID;

  if (!notionToken || !organizationsDbId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  try {
    // Query Notion for organization with this token
    const response = await fetch(`https://api.notion.com/v1/databases/${organizationsDbId}/query`, {
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

    if (!response.ok) {
      throw new Error(`Notion API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.results.length === 0) {
      res.status(404).json({ error: 'Organization not found for token' });
      return;
    }

    const org = data.results[0];

    // Check if organization already has "25/26 Member" tag
    let hasPartnerTag = false;
    if (tagSystemDbId && org.properties['Tag']?.relation) {
      try {

        // Get the "25/26 Member" tag ID
        const partnerTagResponse = await fetch(`https://api.notion.com/v1/databases/${tagSystemDbId}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            filter: {
              property: 'Name',
              title: { equals: '25/26 Member' }
            }
          })
        });

        if (partnerTagResponse.ok) {
          const partnerTagData = await partnerTagResponse.json();

          if (partnerTagData.results.length > 0) {
            const partnerTagId = partnerTagData.results[0].id;

            // Check if organization has this tag
            const orgTagIds = org.properties['Tag'].relation.map(tag => tag.id);
            hasPartnerTag = orgTagIds.includes(partnerTagId);


            if (hasPartnerTag) {
              console.log(`🛑 Organization already renewed: ${org.properties.Organization?.title?.[0]?.text?.content}`);
            }
          }
        }
      } catch (tagError) {
        console.error('⚠️ Error checking member tag:', tagError);
        // Continue without tag check if there's an error
      }
    }

    // Extract organization data (no booth number needed for membership renewal)
    const institutionSize = org.properties['Institution Size']?.select?.name || '';
    const streetAddress = org.properties['Street Address']?.rich_text?.[0]?.text?.content || '';
    const city = org.properties['City']?.rich_text?.[0]?.text?.content || '';
    const province = org.properties['Province']?.select?.name || '';
    const postalCode = org.properties['Postal Code']?.rich_text?.[0]?.text?.content || '';

    // Institution size options for dropdown
    const institutionSizeLabels = {
      'XSmall': 'XSmall (< 2,000 FTE)',
      'Small': 'Small (2,001 - 5,000 FTE)',
      'Medium': 'Medium (5,001 - 10,000 FTE)',
      'Large': 'Large (10,001 - 15,000 FTE)',
      'XLarge': 'XLarge (> 15,001 FTE)'
    };

    const institutionSizeOptions = Object.entries(institutionSizeLabels).map(([value, label]) => ({
      value: value,
      label: label
    }));

    // Province options for dropdown
    const provinceOptions = [
      { value: 'Alberta', label: 'Alberta' },
      { value: 'British Columbia', label: 'British Columbia' },
      { value: 'Manitoba', label: 'Manitoba' },
      { value: 'New Brunswick', label: 'New Brunswick' },
      { value: 'Newfoundland and Labrador', label: 'Newfoundland and Labrador' },
      { value: 'Northwest Territories', label: 'Northwest Territories' },
      { value: 'Nova Scotia', label: 'Nova Scotia' },
      { value: 'Nunavut', label: 'Nunavut' },
      { value: 'Ontario', label: 'Ontario' },
      { value: 'Prince Edward Island', label: 'Prince Edward Island' },
      { value: 'Quebec', label: 'Quebec' },
      { value: 'Saskatchewan', label: 'Saskatchewan' },
      { value: 'Yukon', label: 'Yukon' },
      { value: 'Out of Canada', label: 'Out of Canada' }
    ];

    // Return clean organization data
    const organizationData = {
      organization: {
        name: org.properties.Organization?.title?.[0]?.text?.content || '',
        website: org.properties.Website?.url || '',
        institutionSize: institutionSize,
        address: {
          streetAddress: streetAddress,
          city: city,
          province: province,
          postalCode: postalCode
        }
      },
      institutionSizeOptions: institutionSizeOptions,
      provinceOptions: provinceOptions,
      hasPartnerTag: hasPartnerTag
    };

    res.status(200).json(organizationData);

  } catch (error) {
    console.error('Error fetching organization data:', error);
    res.status(500).json({ error: 'Failed to load organization data', details: error.message });
  }
}