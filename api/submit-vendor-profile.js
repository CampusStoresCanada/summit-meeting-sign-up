// api/submit-vendor-profile.js - Submit to Submissions database for review
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

  const notionToken = process.env.NOTION_TOKEN;
  const submissionsDbId = process.env.NOTION_SUBMISSIONS_DB_ID || '209a69bf0cfd80afa65dcf0575c9224f';
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;
  
  if (!notionToken || !submissionsDbId || !organizationsDbId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }

  try {
    const {
      token,
      formState,
      teamState,
      primaryContactState,
      catalogueState
    } = req.body;

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log('🚀 Creating submission record for token:', token);

    // Step 1: Get organization info for booth number
    const orgResponse = await fetch(`https://api.notion.com/v1/databases/${organizationsDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          property: 'Token',
          rich_text: { equals: token }
        }
      })
    });

    const orgData = await orgResponse.json();
    if (orgData.results.length === 0) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const org = orgData.results[0];
    console.log('🏢 Found organization:', org.properties.Organization?.title?.[0]?.text?.content);

    // Get booth number using the proven method from update-vendor-profile.js
    let boothNumber = 'TBD';
    const boothRelationArray = org.properties['26 Booth Number']?.relation;
    
    if (boothRelationArray && boothRelationArray.length > 0) {
      const boothRelation = boothRelationArray[0];
      const boothResponse = await fetch(`https://api.notion.com/v1/pages/${boothRelation.id}`, {
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28'
        }
      });
      
      if (boothResponse.ok) {
        const boothData = await boothResponse.json();
        const titleText = boothData.properties['Booth Number']?.title?.[0]?.text?.content || '';
        const boothMatch = titleText.match(/^(\d{1,3})/);
        boothNumber = boothMatch ? boothMatch[1] : 'TBD';
        console.log(`🎪 Found booth number: ${boothNumber}`);
      }
    }

    // Step 2: Process conference team changes FIRST (so contacts exist)
    console.log('👥 Processing conference team changes...');
    const teamResults = await processConferenceTeam(token, teamState, primaryContactState.selectedContactId);

    // Step 3: Create comprehensive submission record
    console.log('📝 Creating submission record...');
    const submissionData = {
      parent: { database_id: submissionsDbId },
      properties: {
        "Token": {
          title: [{ text: { content: token } }]
        },
        "Booth Number": {
          rich_text: [{ text: { content: boothNumber } }]
        },
        "Submission Date": {
          date: { start: new Date().toISOString().split('T')[0] }
        },
        "Status": {
          status: { name: "Pending Review" }
        }
      }
    };

    // Add all form fields
    if (formState.companyName) {
      submissionData.properties["Company Name"] = {
        rich_text: [{ text: { content: formState.companyName } }]
      };
    }

    if (formState.website) {
      submissionData.properties["Website URL"] = {
        url: formState.website
      };
    }

    if (formState.category) {
      submissionData.properties["Primary Category"] = {
        select: { name: formState.category }
      };
    }

    if (formState.description) {
      submissionData.properties["Company Description"] = {
        rich_text: [{ text: { content: formState.description } }]
      };
    }

    if (formState.highlightHeadline) {
      submissionData.properties["Highlight Product Name"] = {
        rich_text: [{ text: { content: formState.highlightHeadline } }]
      };
    }

    if (formState.highlightDescription) {
      submissionData.properties["Highlight Product Description"] = {
        rich_text: [{ text: { content: formState.highlightDescription } }]
      };
    }

    if (formState.highlightDeal) {
      submissionData.properties["Conference Special"] = {
        rich_text: [{ text: { content: formState.highlightDeal } }]
      };
    }

    // Add file URLs
    if (formState.highlightImageUrl) {
      submissionData.properties["Highlight Image URL"] = {
        url: formState.highlightImageUrl
      };
    }

    if (catalogueState.uploadedUrl) {
      submissionData.properties["Catalogue"] = {
        url: catalogueState.uploadedUrl
      };
    }

    // Add team summary information
    const attendingCount = Array.isArray(teamState.attendingContacts) ? teamState.attendingContacts.length : 0;
    const newContactsCount = Array.isArray(teamState.newContacts) ? teamState.newContacts.length : 0;
    const editedContactsCount = Object.keys(teamState.editedContacts || {}).length;
    
    submissionData.properties["Team Summary"] = {
      rich_text: [{ 
        text: { 
          content: `${attendingCount} attending, ${newContactsCount} new contacts added, ${editedContactsCount} contacts updated`
        } 
      }]
    };

    // Submit to Notion
    const submissionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(submissionData)
    });

    if (!submissionResponse.ok) {
      const errorData = await submissionResponse.json();
      console.error('❌ Notion submission failed:', errorData);
      throw new Error(`Notion API error: ${errorData.message}`);
    }

    const submission = await submissionResponse.json();
    console.log(`🎉 SUCCESS! Created submission: ${submission.id}`);

    res.status(200).json({
      success: true,
      submissionId: submission.id,
      message: 'Vendor profile submitted for review!',
      results: {
        submission: 'created',
        team: teamResults
      }
    });

  } catch (error) {
    console.error('💥 Error in vendor profile submission:', error);
    res.status(500).json({ 
      error: 'Failed to submit vendor profile', 
      details: error.message 
    });
  }
}

// Helper function to process conference team changes
async function processConferenceTeam(token, teamState, primaryContactId) {
  console.log('👥 Processing conference team changes...');
  
  // Use the existing save-conference-team.js API
  const contactOperations = {
    create: teamState.newContacts || [],
    update: Object.keys(teamState.editedContacts || {}).map(contactId => ({
      originalId: contactId,
      ...teamState.editedContacts[contactId]
    })),
    delete: [], // We're not deleting contacts in this flow
    conferenceTeam: (teamState.attendingContacts || []).map(contactId => ({
      id: contactId,
      attending: true,
      isPrimary: contactId === primaryContactId
    }))
  };

  try {
    // Call the existing conference team API
    const teamResponse = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/save-conference-team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        contactOperations: contactOperations
      })
    });

    if (teamResponse.ok) {
      const teamResult = await teamResponse.json();
      console.log('✅ Conference team processed successfully');
      return teamResult.results;
    } else {
      console.error('❌ Conference team processing failed:', teamResponse.status);
      return { error: 'Failed to process conference team' };
    }
  } catch (error) {
    console.error('💥 Error calling conference team API:', error);
    return { error: error.message };
  }
}
