module.exports = async function handler(req, res) {
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
  
  // Notion API setup
  const accessToken = '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';
  const databaseId = '1f9a69bf0cfd80158cb6f021d5c616cd';
  
  try {
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
    
    const org = data.results[0];
    
    // Get the booth number from the relation display text
    const boothRelation = org.properties['26 Booth Number']?.relation?.[0];
    let boothNumber = 'TBD';
    
    if (boothRelation) {
      // The relation might have a title or we need to fetch it to get the display text
      const boothResponse = await fetch(`https://api.notion.com/v1/pages/${boothRelation.id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Notion-Version': '2022-06-28'
        }
      });
      
      if (boothResponse.ok) {
        const boothData = await boothResponse.json();
        console.log('Booth data:', boothData);
        
        // The booth number should be in the title - extract first 3 digits
        const titleText = boothData.properties.title?.title?.[0]?.text?.content || '';
        const boothMatch = titleText.match(/^(\d{1,3})/); // Extract first 1-3 digits at start
        boothNumber = boothMatch ? boothMatch[1] : 'TBD';
        
        console.log('Extracted booth number:', boothNumber);
      }
    }
        
        // Transform Notion data to what your frontend expects
        const vendorData = {
          boothNumber: boothNumber,
          organization: {
            name: org.properties.Organization?.title?.[0]?.text?.content || '',
            website: org.properties.Website?.url || '',
            primaryCategory: org.properties['Primary Category']?.select?.name || '',
            description: ''
      }
    };
    
    res.status(200).json(vendorData);
    
  } catch (error) {
    console.error('Error fetching vendor data:', error);
    res.status(500).json({ error: 'Failed to load vendor data', details: error.message });
  }
}
