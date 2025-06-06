export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const accessToken = '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';
  const submissionsDbId = '209a69bf0cfd80afa65dcf0575c9224f';
  
  try {
    console.log('Request body:', req.body);
    
    const formData = req.body;
    const { token } = formData;
    
    if (!token) {
      console.log('No token provided');
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log(`Processing submission for token: ${token}`);

    // Skip the organization lookup for now - just create the submission
    const submissionData = {
      parent: { 
        database_id: submissionsDbId
      },
      properties: {
        "Token": {
          title: [{ text: { content: token } }]
        },
        "Booth Number": {
          rich_text: [{ text: { content: "501" } }]
        },
        "Submission Date": {
          date: { start: new Date().toISOString().split('T')[0] }
        },
        "Status": {
          status: { name: "Pending Review" }
        }
      }
    };

    // Add form fields if they exist
    if (formData.companyName) {
      submissionData.properties["Company Name"] = {
        rich_text: [{ text: { content: formData.companyName } }]
      };
    }

    if (formData.primaryCategory) {
      submissionData.properties["Primary Category"] = {
        select: { name: formData.primaryCategory }
      };
    }

    console.log('Submission data:', JSON.stringify(submissionData, null, 2));

    const submissionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(submissionData)
    });

    console.log('Notion response status:', submissionResponse.status);

    if (!submissionResponse.ok) {
      const errorData = await submissionResponse.json();
      console.error('Notion error:', errorData);
      res.status(500).json({ error: 'Notion API error', details: errorData });
      return;
    }

    const submission = await submissionResponse.json();
    console.log(`Success! Created submission: ${submission.id}`);

    res.status(200).json({
      success: true,
      submissionId: submission.id,
      message: 'Profile updated successfully!'
    });
    
  } catch (error) {
    console.error('Caught error:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message,
      stack: error.stack
    });
  }
}
