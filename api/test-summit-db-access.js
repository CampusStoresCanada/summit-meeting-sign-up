// Test if we can access the Summit Registrations database
export default async function handler(req, res) {
  const notionToken = process.env.NOTION_TOKEN;
  const summitRegistrationsDbId = process.env.NOTION_SUMMIT_REGISTRATIONS_DB_ID;

  console.log('Testing Summit Registrations DB access...');
  console.log('Database ID:', summitRegistrationsDbId);

  try {
    // Try to query the database (empty query just to test access)
    const response = await fetch(`https://api.notion.com/v1/databases/${summitRegistrationsDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        page_size: 1
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Cannot access database:', data);
      res.status(response.status).json({
        error: 'Database not accessible',
        details: data,
        suggestion: 'Make sure the Summit Registrations database is shared with your Notion integration'
      });
      return;
    }

    console.log('✅ Database is accessible!');
    console.log('Database has', data.results?.length || 0, 'results in first page');

    res.status(200).json({
      success: true,
      message: 'Database is accessible',
      resultsCount: data.results?.length || 0
    });

  } catch (error) {
    console.error('💥 Error:', error);
    res.status(500).json({
      error: 'Failed to test database access',
      details: error.message
    });
  }
}
