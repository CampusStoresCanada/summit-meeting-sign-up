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
    const formData = req.body;
    const { token } = formData;
    
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log(`Creating submission for token: ${token}`);

    // First, get the booth number from the original organization
    const orgResponse = await fetch(`https://api.notion.com/v1/databases/1f9a69bf0cfd80158cb6f021d5c616cd/query`, {
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

    if (!orgResponse.ok) {
      throw new Error(`Failed to lookup organization: ${orgResponse.status}`);
    }

    const orgData = await orgResponse.json();
    if (orgData.results.length === 0) {
      res.status(404).json({ error: 'Invalid token' });
      return;
    }

    // Create submission record
    const submissionData = {
      parent: { 
        database_id: submissionsDbId
      },
      properties: {
        "Token": {
          title: [{ text: { content: token } }]
        },
        "Booth Number": {
          rich_text: [{ text: { content: "501" } }] // TODO: Get real booth number
        },
        "Submission Date": {
          date: { start: new Date().toISOString().split('T')[0] } // Today's date
        },
        "Status": {
          status: { name: "Pending Review" }
        },
        "Company Name": {
          rich_text: [{ text: { content: formData.companyName || '' } }]
        },
        "Company Description": {
          rich_text: [{ text: { content: formData.companyDescription || '' } }]
        },
        "Primary Category": {
          select: formData.primaryCategory ? { name: formData.primaryCategory } : null
        },
        "Website URL": {
          url: formData.websiteUrl || null
        },
        "Highlight Product Name": {
          rich_text: [{ text: { content: formData.highlightProductName || '' } }]
        },
        "Highlight Product Description": {
          rich_text: [{ text: { content: formData.highlightProductDescription || '' } }]
        }
      }
    };

    console.log('Creating submission record...');
    const submissionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(submissionData)
    });

    if (!submissionResponse.ok) {
      const errorData = await submissionResponse.json();
      console.error('Submission failed:', errorData);
      throw new Error(`Submission failed: ${submissionResponse.status}`);
    }

    const submission = await submissionResponse.json();
    console.log(`Created submission record: ${submission.id}`);

    res.status(200).json({
      success: true,
      submissionId: submission.id,
      message: 'Company profile updated successfully! We\'ll send you a separate link to register your booth staff in a couple weeks.'
    });
    
  } catch (error) {
    console.error('Error updating vendor profile:', error);
    res.status(500).json({ 
      error: 'Failed to update vendor profile', 
      details: error.message 
    });
  }
}
