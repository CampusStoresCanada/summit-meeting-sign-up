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

  try {
    console.log('🪄 Magic starting! Processing vendor profile submission...');
    
    const formData = req.body;
    const { token } = formData;
    
    if (!token) {
      console.log('❌ No token provided');
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log(`✨ Processing submission for token: ${token}`);

    // Check if we have files to upload
    const hasFiles = formData.catalogFile || formData.additionalFiles;
    
    if (hasFiles) {
      console.log('📁 Files detected! Redirecting to Google OAuth...');
      
      // Encode form data in the OAuth state parameter
      const stateData = {
        token: token,
        formData: formData,
        timestamp: Date.now()
      };
      
      const encodedState = Buffer.from(JSON.stringify(stateData)).toString('base64');
      
      // Build Google OAuth URL
      const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
      googleAuthUrl.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI);
      googleAuthUrl.searchParams.set('response_type', 'code');
      googleAuthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
      googleAuthUrl.searchParams.set('state', encodedState);
      googleAuthUrl.searchParams.set('access_type', 'offline');
      googleAuthUrl.searchParams.set('prompt', 'consent');
      
      console.log('🔗 OAuth URL generated, redirecting...');
      
      // Return the OAuth URL for frontend redirect
      res.status(200).json({
        success: true,
        requiresAuth: true,
        authUrl: googleAuthUrl.toString(),
        message: 'Redirecting to Google Drive authorization...'
      });
      
    } else {
      console.log('📝 No files to upload, creating submission directly...');
      
      // No files, create submission directly
      await createVendorSubmission(token, formData, null);
      
      res.status(200).json({
        success: true,
        requiresAuth: false,
        message: 'Profile updated successfully!'
      });
    }
    
  } catch (error) {
    console.error('💥 Magic failed:', error);
    res.status(500).json({ 
      error: 'Server error', 
      details: error.message
    });
  }
}

// Helper function to create vendor submission (shared with google-callback.js)
async function createVendorSubmission(token, formData, googleAccessToken) {
  const notionToken = process.env.NOTION_TOKEN || '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';
  const submissionsDbId = process.env.NOTION_SUBMISSIONS_DB_ID || '209a69bf0cfd80afa65dcf0575c9224f';
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID || '1f9a69bf0cfd80158cb6f021d5c616cd';
  
  try {
    console.log('🏢 Getting organization info...');
    
    // Get organization info to get booth number and company name
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
      throw new Error('Organization not found for token');
    }

    const org = orgData.results[0];
    console.log('✅ Organization found!');
    
    // Get booth number using the proven method from vendor-profile.js
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

    // If we have files and Google access token, upload them
    if (formData.files && formData.files.length > 0 && googleAccessToken) {
      console.log('📎 Uploading files to Google Drive...');
      const fileLinks = await uploadFilesToDrive(
        formData.files, 
        googleAccessToken, 
        org.properties.Organization?.title?.[0]?.text?.content || 'Unknown Organization'
      );
      
      if (fileLinks.length > 0) {
        submissionData.properties["File Links"] = {
          rich_text: [{ text: { content: fileLinks.join('\n') } }]
        };
        console.log(`✅ Uploaded ${fileLinks.length} files!`);
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
      throw new Error(`Notion submission failed: ${submissionResponse.status}`);
    }

    const submission = await submissionResponse.json();
    console.log(`🎉 Success! Created submission: ${submission.id}`);
    
    return submission;
    
  } catch (error) {
    console.error('💥 Error creating vendor submission:', error);
    throw error;
  }
}

// Helper function to upload files to Google Drive
async function uploadFilesToDrive(files, accessToken, organizationName) {
  const fileLinks = [];
  
  try {
    console.log(`📂 Starting upload for ${files.length} files...`);
    
    for (const fileData of files) {
      console.log(`⬆️ Uploading: ${fileData.name}`);
      
      // Create the file metadata
      const metadata = {
        name: `${organizationName} - ${fileData.name}`,
        // TODO: Add to a specific CSC folder
        // parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
      };

      // Upload file to Google Drive
      const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'multipart/related; boundary="boundary_marker"'
        },
        body: createMultipartBody(metadata, fileData, 'boundary_marker')
      });
      
      if (uploadResponse.ok) {
        const fileResult = await uploadResponse.json();
        
        // Make file shareable with anyone with the link
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileResult.id}/permissions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            role: 'reader',
            type: 'anyone'
          })
        });
        
        const fileLink = `https://drive.google.com/file/d/${fileResult.id}/view`;
        fileLinks.push(`${fileData.name}: ${fileLink}`);
        console.log(`✅ Uploaded: ${fileData.name} -> ${fileLink}`);
      } else {
        const errorText = await uploadResponse.text();
        console.error(`❌ Failed to upload: ${fileData.name}`, errorText);
      }
    }
  } catch (error) {
    console.error('💥 Error uploading files to Drive:', error);
  }
  
  return fileLinks;
}

// Helper function to create multipart body for file upload
function createMultipartBody(metadata, fileData, boundary) {
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;
  
  let body = '';
  
  // Add metadata part
  body += delimiter + '\r\n';
  body += 'Content-Type: application/json\r\n\r\n';
  body += JSON.stringify(metadata) + '\r\n';
  
  // Add file content part
  body += delimiter + '\r\n';
  body += `Content-Type: ${fileData.type}\r\n\r\n`;
  body += fileData.content + '\r\n';
  
  body += closeDelimiter;
  
  return body;
}
