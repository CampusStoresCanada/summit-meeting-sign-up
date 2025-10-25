// api/debug-notion-properties.js - Show all Notion Contacts database properties
export default async function handler(req, res) {
  const notionToken = process.env.NOTION_TOKEN;
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;

  if (!notionToken || !contactsDbId) {
    res.status(500).json({ error: 'Missing Notion credentials' });
    return;
  }

  try {
    // Fetch database schema
    const response = await fetch(`https://api.notion.com/v1/databases/${contactsDbId}`, {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(500).json({ error: `Failed to fetch database: ${response.status}`, details: errorText });
      return;
    }

    const database = await response.json();
    const properties = database.properties;

    // Format property names and types
    const propertyList = Object.entries(properties).map(([name, prop]) => ({
      name: name,
      type: prop.type,
      id: prop.id
    }));

    // Sort alphabetically
    propertyList.sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Notion Contacts Database Properties</title>
        <style>
          body { font-family: system-ui; max-width: 1000px; margin: 50px auto; padding: 20px; }
          h1 { color: #2d7a3e; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f5f5f5; font-weight: 600; }
          tr:hover { background: #f9f9f9; }
          .type { color: #666; font-size: 14px; }
          code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
        </style>
      </head>
      <body>
        <h1>📋 Notion Contacts Database Properties</h1>
        <p>Database ID: <code>${contactsDbId}</code></p>
        <p>Total properties: <strong>${propertyList.length}</strong></p>

        <table>
          <thead>
            <tr>
              <th>Property Name</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            ${propertyList.map(prop => `
              <tr>
                <td><code>${prop.name}</code></td>
                <td class="type">${prop.type}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h2>Properties we're currently using in the code:</h2>
        <ul>
          <li><code>Name</code> - title</li>
          <li><code>Work Email</code> - email</li>
          <li><code>Institution</code> - rich_text</li>
          <li><code>Role/Title</code> - rich_text</li>
          <li><code>Work Phone</code> - rich_text</li>
          <li><code>Dietary Restrictions</code> - rich_text</li>
          <li><code>Conference Order ID</code> - rich_text</li>
          <li><code>Personal Tag</code> - relation</li>
        </ul>

        <p><strong>Check if these names match the actual property names above!</strong></p>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
