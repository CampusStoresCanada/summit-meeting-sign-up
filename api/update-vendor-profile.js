// api/update-vendor-profile.js - NOW IMPROVED WITH THE FLAVOUR OF URLs.
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

  const notionToken = process.env.NOTION_TOKEN || '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';
  const submissionsDbId = process.env.NOTION_SUBMISSIONS_DB_ID || '209a69bf0cfd80afa65dcf0575c9224f';
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID || '1f9a69bf0cfd80158cb6f021d5c616cd';
  
  try {
    console.log('🪄 Processing vendor profile submission...');
    
    const formData = req.body;
    const { token, uploadResults } = formData;
    
    if (!token) {
      console.log('❌ No token provided');
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log('✨ Processing submission for token:', token);
    console.log('📁 Upload results:', uploadResults);

    // Get organization info to get booth number
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
      console.log('❌ Organization not found for token:', token);
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const org = orgData.results[0];
    console.log('✅ Organization found!');
    
    // Get booth number using proven method
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

    // Create submission record in Notion
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

    // Add form fields if they exist
    if (formData.companyName) {
      submissionData.properties["Company Name"] = {
        rich_text: [{ text: { content: formData.companyName } }]
      };
    }

    if (formData.companyDescription) {
      submissionData.properties["Company Description"] = {
        rich_text: [{ text: { content: formData.companyDescription } }]
      };
    }

    if (formData.primaryCategory) {
      submissionData.properties["Primary Category"] = {
        select: { name: formData.primaryCategory }
      };
    }

    if (formData.websiteUrl) {
      submissionData.properties["Website URL"] = {
        url: formData.websiteUrl
      };
    }

    if (formData.highlightProductName) {
      submissionData.properties["Highlight Product Name"] = {
        rich_text: [{ text: { content: formData.highlightProductName } }]
      };
    }

    if (formData.highlightProductDescription) {
      submissionData.properties["Highlight Product Description"] = {
        rich_text: [{ text: { content: formData.highlightProductDescription } }]
      };
    }

    // 🎯 Add file URLs from S3 upload results!
    if (uploadResults) {
      if (uploadResults.catalogueUrl) {
        submissionData.properties["Catalogue"] = {
          url: uploadResults.catalogueUrl
        };
        console.log('📄 Added catalogue URL:', uploadResults.catalogueUrl);
      }

      if (uploadResults.otherFiles && uploadResults.otherFiles.length > 0) {
        // Create clean S3 folder URL
        const folderUrl = `https://s3.console.aws.amazon.com/s3/buckets/${process.env.AWS_S3_BUCKET}?prefix=vendors/${org.properties.Organization?.title?.[0]?.text?.content.replace(/[^a-zA-Z0-9 ]/g, '-').replace(/\s+/g, '-')}/docs/`;
        submissionData.properties["Other Docs"] = {
          url: folderUrl
        };
        console.log('📁 Added docs folder URL:', folderUrl);
      }
    }

    console.log('💾 Creating Notion submission...');
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
      res.status(500).json({ error: 'Notion API error', details: errorData });
      return;
    }

    const submission = await submissionResponse.json();
    console.log(`🎉 SUCCESS! Created submission: ${submission.id}`);

    res.status(200).json({
      success: true,
      submissionId: submission.id,
      message: 'Profile updated successfully!',
      uploadResults: uploadResults
    });
    
  } catch (error) {
    console.error('💥 Server error:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message 
    });
  }
}
