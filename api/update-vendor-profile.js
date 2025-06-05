// api/update-vendor-profile.js
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

  // Use the new vendor portal OAuth token
  const accessToken = process.env.NOTION_VENDOR_TOKEN;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  };

  try {
    // Parse form data (handles both JSON and FormData)
    let formData;
    if (req.headers['content-type']?.includes('application/json')) {
      formData = req.body;
    } else {
      // Handle FormData from file uploads
      formData = req.body;
    }

    const { token } = formData;
    
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log(`Updating vendor profile for token: ${token}`);

    // Step 1: Validate token
    const tokenData = await validateToken(token);
    if (!tokenData) {
      res.status(404).json({ error: 'Invalid or expired token' });
      return;
    }

    // Step 2: Create submission record in "Vendor Profile Submissions" database
    // You'll need to create this database first with the appropriate fields
    const submissionData = {
      parent: { 
        database_id: "VENDOR_SUBMISSIONS_DATABASE_ID" // Replace with actual database ID
      },
      properties: {
        "Token": {
          rich_text: [{ text: { content: token } }]
        },
        "Booth Number": {
          rich_text: [{ text: { content: tokenData.boothNumber } }]
        },
        "Submission Date": {
          date: { start: new Date().toISOString() }
        },
        "Status": {
          select: { name: "Pending Review" }
        },
        "Company Name": {
          rich_text: [{ text: { content: formData.companyName || '' } }]
        },
        "Primary Category": {
          select: { name: formData.primaryCategory || '' }
        },
        "Website URL": {
          url: formData.websiteUrl || null
        },
        "Company Description": {
          rich_text: [{ text: { content: formData.companyDescription || '' } }]
        },
        "Highlight Product Name": {
          rich_text: [{ text: { content: formData.highlightProductName || '' } }]
        },
        "Highlight Product Description": {
          rich_text: [{ text: { content: formData.highlightProductDescription || '' } }]
        }
      }
    };

    // Step 3: Process contacts data
    const contacts = [];
    Object.keys(formData).forEach(key => {
      if (key.startsWith('contacts[')) {
        const match = key.match(/contacts\[([^\]]+)\]\[([^\]]+)\]/);
        if (match) {
          const [, contactId, field] = match;
          if (!contacts[contactId]) contacts[contactId] = {};
          contacts[contactId][field] = formData[key];
        }
      }
    });

    // Add contacts to submission
    if (Object.keys(contacts).length > 0) {
      const contactsText = Object.values(contacts)
        .filter(contact => contact.name) // Only include contacts with names
        .map(contact => 
          `${contact.name} (${contact.title || 'No title'}) - ${contact.email || 'No email'} - Circle: ${contact.circle || 'None'}`
        )
        .join('\n');
      
      submissionData.properties["Contacts"] = {
        rich_text: [{ text: { content: contactsText } }]
      };
    }

    // Step 4: Submit to Notion
    console.log('Creating submission record...');
    const submissionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify(submissionData)
    });

    if (!submissionResponse.ok) {
      const errorData = await submissionResponse.json();
      console.error('Submission failed:', errorData);
      throw new Error(`Submission failed: ${submissionResponse.status}`);
    }

    const submission = await submissionResponse.json();
    console.log(`Created submission record: ${submission.id}`);

    // Step 5: Update token status to "completed"
    await updateTokenStatus(token, 'completed');

    // Step 6: TODO - Handle file uploads to Notion
    // Files would need to be processed and attached to the submission record
    // This requires additional handling for multipart/form-data

    res.status(200).json({
      success: true,
      submissionId: submission.id,
      message: 'Profile updated successfully and is now under review'
    });
    
  } catch (error) {
    console.error('Error updating vendor profile:', error);
    res.status(500).json({ 
      error: 'Failed to update vendor profile', 
      details: error.message 
    });
  }
}

// Update token status in Zapier Tables
async function updateTokenStatus(token, status) {
  // This would update the status in Zapier Tables
  // For now, just log it
  console.log(`Token ${token} status updated to: ${status}`);
}

// Temporary token validation - replace with actual Zapier Tables lookup
async function validateToken(token) {
  // TEMP: Accept any token for now
  return { 
    boothNumber: '999', 
    email: 'temp@example.com', 
    orgId: 'temp-org' 
  };
}
