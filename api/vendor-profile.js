module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://membershiprenewal.campusstores.ca');
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
  
  // Notion API setup - NOW WITH ENVIRONMENT VARIABLES!
  const accessToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  
  // Safety check
  if (!accessToken || !databaseId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }
  
  try {
    // Rest of the function stays exactly the same...
    // Query Notion for organization with this token
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
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
    
    if (!response.ok) {
      throw new Error(`Notion API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.results.length === 0) {
      res.status(404).json({ error: 'Invalid token' });
      return;
    }
    console.log('🧪 ENV TEST - NOTION_TOKEN exists:', !!process.env.NOTION_TOKEN);
    console.log('🧪 ENV TEST - NOTION_ORGANIZATIONS_DB_ID exists:', !!process.env.NOTION_ORGANIZATIONS_DB_ID);
    console.log('🧪 ENV TEST - First 10 chars of hardcoded token:', accessToken.slice(0, 10));

    const org = data.results[0];
    
    // SINGLE SOURCE OF TRUTH: Get booth number from Organization database only
    let boothNumber = 'TBD';
    
    // Check the '26 Booth Number' relation property
    const boothRelationArray = org.properties['26 Booth Number']?.relation;
    
    if (boothRelationArray && boothRelationArray.length > 0) {
      // Follow the relation to get the booth record (ONE API call only)
      const boothRelation = boothRelationArray[0];
      
      const boothResponse = await fetch(`https://api.notion.com/v1/pages/${boothRelation.id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Notion-Version': '2022-06-28'
        }
      });
      
      if (boothResponse.ok) {
        const boothData = await boothResponse.json();
        
        // Extract booth number from the title (first 3 characters only)
        const titleText = boothData.properties['Booth Number']?.title?.[0]?.text?.content || '';
        const boothMatch = titleText.match(/^(\d{1,3})/);
        boothNumber = boothMatch ? boothMatch[1] : 'TBD';
        
        console.log(`Found booth number: ${boothNumber} from title: ${titleText}`);
      }
    } else {
      console.log(`No booth relation found for token: ${token}`);
    }
    
    // Extract logo URL if available
    const logoUrl = org.properties.Logo?.files?.[0]?.external?.url ||
                   org.properties.Logo?.files?.[0]?.file?.url ||
                   '';

    // Extract institution size (handle both Select and Formula types)
    const institutionSize = org.properties['Institution Size']?.select?.name
      || org.properties['Institution Size']?.formula?.string
      || '';

    // Extract address information
    const streetAddress = org.properties['Street Address']?.rich_text?.[0]?.text?.content || '';
    const city = org.properties['City']?.rich_text?.[0]?.text?.content || '';
    const province = org.properties['Province']?.select?.name || '';
    const postalCode = org.properties['Postal Code']?.rich_text?.[0]?.text?.content || '';

    // Translation map for Institution Size
    const institutionSizeLabels = {
      'XSmall': 'XSmall (< 2,000 FTE)',
      'Small': 'Small (2,001 - 5,000 FTE)',
      'Medium': 'Medium (5,001 - 10,000 FTE)',
      'Large': 'Large (10,001 - 15,000 FTE)',
      'XLarge': 'XLarge (> 15,001 FTE)'
    };

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

    // Create options array for institution size dropdown
    const institutionSizeOptions = Object.entries(institutionSizeLabels).map(([value, label]) => ({
      value: value,
      label: label
    }));

    // Return the data
    const vendorData = {
      boothNumber: boothNumber,
      organization: {
        name: org.properties.Organization?.title?.[0]?.text?.content || '',
        website: org.properties.Website?.url || '',
        primaryCategory: org.properties['Primary Category']?.select?.name || '',
        institutionSize: institutionSize,
        logo: logoUrl,
        address: {
          streetAddress: streetAddress,
          city: city,
          province: province,
          postalCode: postalCode
        }
      },
      institutionSizeOptions: institutionSizeOptions,
      provinceOptions: provinceOptions
    };
    
    res.status(200).json(vendorData);
    
  } catch (error) {
    console.error('Error fetching vendor data:', error);
    res.status(500).json({ error: 'Failed to load vendor data', details: error.message });
  }
}
