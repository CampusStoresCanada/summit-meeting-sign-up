// Replace the hardcoded section in vendor-profile.js with this:

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
    
    // ... rest of function unchanged ...
