// Check which integration the NOTION_TOKEN belongs to
export default async function handler(req, res) {
  const notionToken = process.env.NOTION_TOKEN;

  if (!notionToken) {
    res.status(500).json({ error: 'NOTION_TOKEN not set' });
    return;
  }

  try {
    // Get info about the bot/integration
    const response = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: 'Failed to get integration info',
        details: data
      });
      return;
    }

    res.status(200).json({
      integrationName: data.name || data.bot?.owner?.user?.name || 'Unknown',
      integrationType: data.type,
      botId: data.id,
      fullData: data
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to check integration',
      details: error.message
    });
  }
}
