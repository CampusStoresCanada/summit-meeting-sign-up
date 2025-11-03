// Get the actual property names from Summit Meeting Registration database
export default async function handler(req, res) {
  const notionToken = process.env.NOTION_TOKEN;
  const summitRegistrationsDbId = process.env.NOTION_SUMMIT_REGISTRATIONS_DB_ID;

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${summitRegistrationsDbId}`, {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: 'Failed to get database', details: data });
      return;
    }

    // Extract property names and types
    const properties = {};
    for (const [name, prop] of Object.entries(data.properties)) {
      properties[name] = prop.type;
    }

    res.status(200).json({
      databaseTitle: data.title?.[0]?.plain_text || 'Unknown',
      properties: properties,
      propertyCount: Object.keys(properties).length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
